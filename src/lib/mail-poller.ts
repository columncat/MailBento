import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import { fetchAllInboxes } from "./mail-fetch";
import { clipSubject, detectInjection, maskEmail } from "./injection";
import { refreshMailCache } from "./mail-cache";

/**
 * 서버가 스스로 메일을 가져온다.
 *
 * 예전에는 화면이 열려 있을 때만 주기적으로 새로고침했다. 브라우저를 닫아 두면
 * 아무 일도 일어나지 않았고, 그래서 "새 메일이 왔다" 를 알아챌 수 있는 곳이
 * 없었다. 이제는 컨테이너가 살아 있는 동안 계속 돈다.
 *
 * 캐시는 만료로 버리지 않는다. 갱신이 **성공했을 때만** 갈아끼운다 — IMAP 이
 * 잠깐 죽어도 화면은 직전 값을 계속 보여 준다.
 */

const INTERVAL_MS = 10 * 60 * 1000;

/** 새 메일을 넘길 곳. 없으면 판정만 하고 아무 데도 보내지 않는다. */
const AGENT_URL = process.env.AGENT_URL?.trim();
const AGENT_TOKEN = process.env.AGENT_TOKEN?.trim();

/** 한 번에 에이전트에게 넘길 최대 통수. 폭주한 메일함이 대화를 덮지 않게. */
const MAX_HANDOFF = 20;

export interface NewMail {
  accountId: number;
  mailbox: string;
  messageId: string;
  subject: string;
  from: string;
  receivedAt: number;
}

/**
 * 한 번 수집한다. `instrumentation` 의 타이머가 라우트를 통해 부른다.
 *
 * 겹쳐 돌지 않게 막는다 — 느린 IMAP 이 겹치면 같은 메일을 두 번 새것으로 볼 수
 * 있다.
 */
let running = false;

export async function pollOnce(): Promise<{ newMails: number; skipped?: true }> {
  if (running) return { newMails: 0, skipped: true };
  running = true;
  try {
    const payload = await refreshMailCache(fetchAllInboxes);
    const fresh = detectNew(payload.inboxes);
    if (fresh.length === 0) return { newMails: 0 };

    /*
     * 주입 흔적이 있는 것은 에이전트에게 보내지 않는다.
     *
     * 값싼 1차 거름망이다. 표현을 바꾸면 지나가므로 이걸 믿고 뒤를 느슨하게
     * 두면 안 된다 — 진짜 방어는 에이전트에게 도구를 주지 않고 출력을 1비트로
     * 묶은 쪽에 있다. 다만 걸린 것은 사용자가 알아야 한다.
     */
    const safe: NewMail[] = [];
    const blocked: { subject: string; marker: string; field: string; mailbox: string }[] = [];
    for (const m of fresh) {
      const hit = detectInjection([
        { field: "제목", value: m.subject },
        { field: "보낸이", value: m.from },
      ]);
      if (hit) blocked.push({ subject: m.subject, marker: hit.marker, field: hit.field, mailbox: m.mailbox });
      else safe.push(m);
    }

    console.log(
      `[poll] 새 메일 ${fresh.length}통` +
        (blocked.length ? ` (차단 ${blocked.length})` : "") +
        // 넘치면 뒤쪽이 버려진다. 조용히 버리면 "왜 이 메일은 안 물어봤지" 를
        // 되짚을 때 아무 단서가 없다.
        (safe.length > MAX_HANDOFF ? ` — ${safe.length - MAX_HANDOFF}통은 이번에 넘기지 않음` : ""),
    );
    if (blocked.length > 0) await reportBlocked(blocked);
    if (safe.length > 0) await handOff(safe.slice(0, MAX_HANDOFF));
    return { newMails: fresh.length };
  } catch (e) {
    console.error("[poll] 실패:", e instanceof Error ? e.message : e);
    return { newMails: 0 };
  } finally {
    running = false;
  }
}

/**
 * 처음 보는 메일만 골라낸다.
 *
 * 조회에 실패한 메일함은 건너뛴다 — 목록이 비어서 온 것을 "다 읽었다" 로
 * 읽으면 다음 성공 때 받은편지함 전체가 새 메일이 된다.
 */
function detectNew(inboxes: {
  account: { id: number; displayName: string };
  messages: { id: string; subject: string; from: { name: string | null; email: string }; receivedAt: number }[];
  error?: string | null;
}[]): NewMail[] {
  const out: NewMail[] = [];
  const now = Date.now();

  for (const box of inboxes) {
    if (box.error) continue;
    const ids = box.messages.map((m) => m.id);
    if (ids.length === 0) continue;

    const known = new Set(
      db
        .select({ id: schema.seenMessages.messageId })
        .from(schema.seenMessages)
        .where(
          and(
            eq(schema.seenMessages.accountId, box.account.id),
            inArray(schema.seenMessages.messageId, ids),
          ),
        )
        .all()
        .map((r) => r.id),
    );

    // 이 메일함을 처음 본다면 지금 있는 것은 전부 "이미 있던 것" 으로 친다.
    // 안 그러면 붙이자마자 받은편지함 전체가 새 메일로 쏟아진다.
    const firstTime =
      known.size === 0 &&
      db
        .select({ id: schema.seenMessages.messageId })
        .from(schema.seenMessages)
        .where(eq(schema.seenMessages.accountId, box.account.id))
        .limit(1)
        .all().length === 0;

    for (const m of box.messages) {
      if (known.has(m.id)) continue;
      db.insert(schema.seenMessages)
        .values({ accountId: box.account.id, messageId: m.id, firstSeenAt: now })
        .onConflictDoNothing()
        .run();
      if (firstTime) continue;
      out.push({
        accountId: box.account.id,
        mailbox: box.account.displayName,
        messageId: m.id,
        subject: m.subject || "(제목 없음)",
        from: m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email,
        receivedAt: m.receivedAt,
      });
    }
  }
  return out;
}

/**
 * 에이전트에게 **제목만** 넘긴다.
 *
 * 본문은 보내지 않는다. 메일은 남이 내용을 정하는 입력이라, 자동으로 본문까지
 * 읽히면 그 안에 적힌 지시가 에이전트를 움직일 수 있다. 본문은 사용자가
 * Discord 버튼으로 허락한 것만 읽는다.
 */
async function handOff(mails: NewMail[]): Promise<void> {
  if (!AGENT_URL || !AGENT_TOKEN) return;
  // 제목은 자르고 주소는 가려서 보낸다. 둘 다 남이 정하는 문자열이라,
  // 판정에 필요한 만큼만 넘긴다.
  const trimmed = mails.map((m) => ({
    ...m,
    subject: clipSubject(m.subject),
    from: maskEmail(m.from),
  }));
  try {
    const res = await fetch(new URL("/triage", AGENT_URL), {
      method: "POST",
      headers: {
        authorization: `Bearer ${AGENT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ mails: trimmed }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      console.error(`[mail-poller] 에이전트 응답 ${res.status}`);
    }
  } catch (e) {
    console.error("[mail-poller] 에이전트에 닿지 못함:", e instanceof Error ? e.message : e);
  }
}

/**
 * 차단한 것을 사용자에게 알린다.
 *
 * 문장은 BentoAgent 쪽에서 고정으로 쓴다. 여기서는 무엇이 걸렸는지만 넘긴다 —
 * 제목은 앞 8글자만. 걸린 제목을 통째로 보여 주면 그게 곧 공격자의 문장을
 * 화면에 띄우는 일이 된다.
 */
async function reportBlocked(
  items: { subject: string; marker: string; field: string; mailbox: string }[],
): Promise<void> {
  if (!AGENT_URL || !AGENT_TOKEN) return;
  try {
    await fetch(new URL("/security-alert", AGENT_URL), {
      method: "POST",
      headers: {
        authorization: `Bearer ${AGENT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        blocked: items.map((b) => ({
          head: b.subject.replace(/\s+/g, " ").trim().slice(0, 8),
          marker: b.marker,
          field: b.field,
          mailbox: b.mailbox,
        })),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    console.error("[poll] 차단 알림 실패:", e instanceof Error ? e.message : e);
  }
}
