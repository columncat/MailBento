import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import { fetchAllInboxes } from "./mail-fetch";
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

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startMailPoller(): void {
  if (timer) return;
  // 기동 직후 한 번. 컨테이너를 막 올렸을 때 10분을 기다릴 이유가 없다.
  setTimeout(() => void tick(), 5000);
  timer = setInterval(() => void tick(), INTERVAL_MS);
  console.log(`[mail-poller] ${INTERVAL_MS / 60000}분마다 자동 수집`);
}

async function tick(): Promise<void> {
  // 한 번에 하나만. 느린 IMAP 이 겹치면 같은 메일을 두 번 새것으로 볼 수 있다.
  if (running) return;
  running = true;
  try {
    const payload = await refreshMailCache(fetchAllInboxes);
    const fresh = detectNew(payload.inboxes);
    if (fresh.length === 0) return;
    console.log(`[mail-poller] 새 메일 ${fresh.length}통`);
    await handOff(fresh.slice(0, MAX_HANDOFF));
  } catch (e) {
    console.error("[mail-poller] 실패:", e instanceof Error ? e.message : e);
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
  try {
    const res = await fetch(new URL("/triage", AGENT_URL), {
      method: "POST",
      headers: {
        authorization: `Bearer ${AGENT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ mails }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      console.error(`[mail-poller] 에이전트 응답 ${res.status}`);
    }
  } catch (e) {
    console.error("[mail-poller] 에이전트에 닿지 못함:", e instanceof Error ? e.message : e);
  }
}
