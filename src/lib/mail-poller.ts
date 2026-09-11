import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import type { Account } from "./db/schema";
import { imapErrorDetail } from "./imap-error";
import { fetchAllInboxes } from "./mail-fetch";
import { clipSubject, detectInjection, maskEmail } from "./injection";
import { refreshMailCache } from "./mail-cache";
import { rememberDetail } from "./message-detail-cache";
import { getProvider, isProviderImplemented } from "./providers";

/**
 * 서버가 스스로 메일을 가져온다.
 *
 * 예전에는 화면이 열려 있을 때만 주기적으로 새로고침했다. 브라우저를 닫아 두면
 * 아무 일도 일어나지 않았고, 그래서 "새 메일이 왔다" 를 알아챌 수 있는 곳이
 * 없었다. 이제는 컨테이너가 살아 있는 동안 계속 돈다.
 *
 * 캐시는 만료로 버리지 않는다. 갱신이 **성공했을 때만** 갈아끼운다 — IMAP 이
 * 잠깐 죽어도 화면은 직전 값을 계속 보여 준다.
 *
 * 한 번 도는 동안 하는 일은 넷이고, 순서에 뜻이 있다:
 *   1. 봉투를 받아 캐시를 갈아끼운다 (= 수집)
 *   2. 처음 보는 메일을 고르고, 주입 흔적이 있는 것을 거른다
 *   3. 사람에게 알린다 (차단 보고 → 에이전트 넘기기; **제목·보낸이만**)
 *   4. 새 메일의 **본문**을 미리 받아 캐시에 담는다 (`prefetchBodies`)
 *
 * 4 가 맨 뒤인 것은 아무도 그것을 기다리지 않기 때문이다. 3 을 늦추면 사람이
 * 새 메일을 늦게 안다.
 */

const INTERVAL_MS = 10 * 60 * 1000;

/** 새 메일을 넘길 곳. 없으면 판정만 하고 아무 데도 보내지 않는다. */
const AGENT_URL = process.env.AGENT_URL?.trim();
const AGENT_TOKEN = process.env.AGENT_TOKEN?.trim();

/** 한 번에 에이전트에게 넘길 최대 통수. 폭주한 메일함이 대화를 덮지 않게. */
const MAX_HANDOFF = 20;

/**
 * ── 새 메일의 본문을 미리 받아 둘 것인가 ──
 *
 * `MAIL_PREFETCH=0|off|false|no` 면 끈다. 기본은 켜짐.
 *
 * 끌 수 있어야 하는 이유가 셋 있다. (1) 미리 받기는 사람이 안 볼 수도 있는
 * 메일에 IMAP 왕복과 디스크를 쓴다 — 데이터 요금이 아까운 회선이나 아주 작은
 * 볼륨에서는 손해다. (2) 사람이 안 연 메일의 본문이 디스크에 앉는 것 자체를
 * 원치 않을 수 있다(캐시는 `secure_delete` 로 씻지만 30일은 남는다).
 * (3) 이 기능이 수집을 늦춘다고 의심될 때, 코드를 되돌리지 않고 껐다 켜며
 * 로그를 견줄 수 있어야 한다.
 *
 * `env.ts` 가 아니라 여기서 `process.env` 를 직접 읽는 것은 이 파일의 기존
 * 관례를 따른 것이다(`AGENT_URL`·`AGENT_TOKEN` 도 그렇다). 수집기에만 뜻이
 * 있는 손잡이라 굳이 전역 스키마로 올리지 않는다.
 */
const PREFETCH_ENABLED = !/^(0|off|false|no)$/i.test(
  process.env.MAIL_PREFETCH?.trim() ?? "",
);

/**
 * 한 번 수집에 미리 받을 최대 통수.
 *
 * 10 인 근거 — 흉내 서버(왕복 30ms · LOGIN 200ms · 2MB/s, 원격 IMAP 을
 * 짐작한 값)로 재 보니 열 통에 8.9초, 4MB 짜리 하나가 낀 열네 통 표본에서
 * 11.4초였다. 수집 주기(10분)의 2% 다. 스무 통으로 늘려도 여전히 5% 안이지만,
 * 그만큼 미리 받은 것이 캐시에서 사람 몫을 밀어내는 속도도 빨라진다 —
 * 시간보다 **캐시 자리**가 먼저 아프다.
 *
 * 위의 `MAX_HANDOFF`(20) 보다 작게 잡은 것은 일부러다: 에이전트에 제목을
 * 넘기는 것은 왕복 한 번이지만 본문은 통마다 왕복이라 값이 선형으로 는다.
 *
 * 넘치면 **새 것부터** 받는다. 사람이 다음에 열 것은 대개 가장 새 메일이다.
 */
const PREFETCH_MAX = 10;

/**
 * 미리 받기에 쓸 수 있는 총 시간.
 *
 * 통수 상한만으로는 부족하다 — 한 통이 `socketTimeout`(30초)을 꽉 채우는 일이
 * 있고, 그런 통이 몇 개면 수집 주기를 넘길 수 있다. 60초는 주기(10분)의 10%
 * 이고, 이 시간을 다 써도 **다음 수집이 밀리지 않는다**(`running` 이 풀린
 * 뒤로도 9분이 남는다). 통 하나를 시작하기 전에만 본다 — 도중에 끊으면
 * 받다 만 본문이 남는다.
 */
const PREFETCH_BUDGET_MS = 60_000;

/**
 * 잇달아 이만큼 실패하면 이번 수집의 미리 받기를 접는다.
 *
 * 한 통 실패는 그 통만 건너뛴다(다음에 사람이 열 때 받으면 그만이다). 하지만
 * 셋이 잇달아 실패하면 그건 그 메일 탓이 아니라 서버가 죽었거나 연결 수를
 * 조이고 있다는 뜻이다 — 그 상태에서 남은 일곱 통을 마저 두드리면 상황을
 * 나쁘게만 만든다(Gmail 은 반복 실패에 계정을 일시 차단한다).
 */
const PREFETCH_FAIL_STREAK = 3;

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

    /*
     * 본문 미리 받기는 **맨 마지막이다.**
     *
     * 앞의 두 줄(차단 알림·에이전트 넘기기)이 사람이 기다리는 일이다. 미리
     * 받기는 아무도 기다리지 않는 일이라, 사람에게 알리는 것을 한 순간도
     * 늦추면 안 된다. 수집 자체(`refreshMailCache`·`detectNew`)는 이미 위에서
     * 끝났으므로 화면이 보는 목록도 여기까지 오기 전에 새것이 되어 있다.
     *
     * 여기서 한 번 더 감싼다. 안쪽이 통마다 잡고는 있지만, 그 밖에서 뭔가
     * 던지면(계정 조회 실패 같은) 아래 `catch` 가 그것을 **수집 실패**로 적고
     * `newMails: 0` 을 돌려준다 — 봉투는 멀쩡히 받아 왔고 에이전트에게도 이미
     * 넘긴 뒤인데. 나중에 온 사람이 로그만 보고 수집이 죽었다고 읽게 된다.
     */
    if (PREFETCH_ENABLED) {
      try {
        await prefetchBodies(fresh);
      } catch (e) {
        console.error(
          "[poll] 미리 받기가 통째로 실패 (수집은 성공):",
          e instanceof Error ? e.message : e,
        );
      }
    }
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
 * 새 메일의 **본문**을 미리 받아 캐시에 담는다.
 *
 * 왜 — 지금까지 수집기는 봉투(제목·보낸이·날짜)만 받았다. 그래서 사람이 새
 * 메일을 처음 열 때는 언제나 IMAP 왕복이 일어났다. 본문 캐시는 이미 있는데
 * **두 번째 열기부터만** 빨랐던 셈이다. 새 메일이 왔다는 것을 우리가 이미
 * 알고 있으니, 그때 본문까지 받아 두면 첫 열기도 캐시 적중이 된다.
 *
 * **에이전트에게 가는 것은 달라지지 않는다.** 여기서 받은 본문은 디스크의
 * 캐시에만 들어가고, `handOff` 는 여전히 제목과 보낸이만 넘긴다. 메일은 남이
 * 내용을 정하는 입력이고, 본문을 자동으로 에이전트에게 먹이면 그 안에 적힌
 * 지시가 에이전트를 움직인다. 받아 두는 것과 먹이는 것은 다른 일이다.
 *
 * 주입 흔적이 걸린 메일(`blocked`)도 미리 받는다. 그 판정은 "에이전트에게
 * 보내지 않는다" 는 뜻이지 "사람이 못 본다" 가 아니고, 사람이 열면 어차피
 * 같은 정제기를 지나 같은 화면에 뜬다. 걸린 것만 느리게 열릴 이유가 없다.
 */
async function prefetchBodies(fresh: NewMail[]): Promise<void> {
  const deadline = Date.now() + PREFETCH_BUDGET_MS;
  const started = Date.now();

  /*
   * 새 것부터. 사람이 다음에 여는 것은 대개 가장 새 메일이고, 상한에 걸려
   * 잘리는 쪽은 그 반대편이어야 한다.
   *
   * 계정별로 나누지 않고 통째로 줄 세운다 — 한 메일함이 폭주하면 다른 메일함의
   * 새 메일은 미리 못 받고 밀린다. 그래도 이렇게 두는 이유는, 그 상황에서
   * "가장 새 메일" 이 실제로 그 폭주한 메일함에 있기 때문이다. 밀린 쪽이
   * 치르는 값은 예전과 같은 첫 열기 한 번뿐이다.
   */
  const targets = [...fresh]
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, PREFETCH_MAX);
  /*
   * 잘려 나간 것은 **다음 수집으로 미뤄지지 않는다.** 그 UID 는 방금
   * `detectNew` 가 seen_messages 에 적었으므로 다시는 새 메일이 아니다.
   * 미리 받기는 통마다 한 번뿐이고, 못 받은 것은 사람이 열 때 예전처럼
   * 받는다 — 이 기능이 생기기 전과 똑같은 값이다. 로그가 "건너뜀" 이라고
   * 적는 이유다.
   */
  const skipped = fresh.length - targets.length;

  // 계정 행은 한 번에 읽는다. `fetchMessage` 도 `rememberDetail`(지문) 도
  // id 가 아니라 행을 받는다.
  const ids = [...new Set(targets.map((m) => m.accountId))];
  const accounts = new Map<number, Account>(
    db
      .select()
      .from(schema.accounts)
      .where(inArray(schema.accounts.id, ids))
      .all()
      .map((a) => [a.id, a]),
  );

  let stored = 0;
  let tooBig = 0;
  let failed = 0;
  let streak = 0;
  let done = 0;

  /*
   * **한 통씩, 줄 세워서.** 열 통을 한꺼번에 던지면 빨라지지만, 그 순간
   * 계정마다 IMAP 연결이 최대 셋(풀 상한)까지 한꺼번에 열린다. 아무도
   * 기다리지 않는 일에 연결을 그렇게 쓸 이유가 없다 — Gmail 은 계정당 동시
   * 15개이고, 그 자리는 사람이 메일을 열고 그림을 받는 데 쓰여야 한다.
   *
   * 줄을 세우면 미리 받기가 한 번에 쥐는 연결은 **어느 순간에도 하나**다.
   * 재 봤다(계정 10개 · 각 새 메일 1통, 흉내 서버): 동시에 열린 연결의
   * 최대치가 미리 받기를 껐을 때와 켰을 때 모두 10 — 봉투를 받느라 이미
   * 열리는 계정당 하나가 천장이고, 미리 받기는 그 천장을 올리지 않는다.
   * 늘어난 것은 총 LOGIN 수뿐이다(20 → 30, 계정당 한 번씩).
   */
  for (const m of targets) {
    /*
     * 시간을 다 썼으면 **시작하지 않는다.** 도중에 끊는 길은 두지 않았다 —
     * 받다 만 원문을 파서에 먹이면 잘린 본문이 캐시에 앉는다.
     */
    if (Date.now() >= deadline) break;

    const account = accounts.get(m.accountId);
    if (!account || !isProviderImplemented(account.provider)) continue;

    done++;
    try {
      /*
       * 옵션을 안 넘긴다 = `inlineImages: "link"` — **사람이 여는 길과 똑같이.**
       * 여기서 보관용("embed")으로 받으면 그림이 `data:` 로 구워진 본문이
       * 캐시에 앉아, 화면이 쓰기에는 무겁고 1MB 상한에도 훨씬 잘 걸린다.
       * 캐시에 담기는 모양은 담는 쪽이 아니라 **쓰는 쪽**이 정한다.
       */
      const detail = await getProvider(account.provider).fetchMessage(
        account,
        m.messageId,
      );
      if (rememberDetail(account, m.messageId, detail, { prefetched: true })) {
        stored++;
      } else {
        /*
         * 통당 상한(1MB)에 걸려 안 담겼다. 받아 온 왕복은 헛수고다.
         *
         * 미리 거를 길이 없다 — 목록(봉투)에는 크기가 없고, 크기를 알려면
         * 결국 그 통을 받아 봐야 한다. 그래도 헛수고가 **반복되지는 않는다**:
         * 미리 받기는 `detectNew` 가 처음 본 UID 에만 돌고, 그 UID 는 그
         * 자리에서 seen_messages 에 적혀 다음 수집에는 새것이 아니다. 한 통당
         * 최대 한 번이다.
         */
        tooBig++;
      }
      streak = 0;
    } catch (e) {
      failed++;
      streak++;
      /*
       * 한 통의 실패는 그 통만 건너뛴다. 사람이 열 때 받으면 그만이고, 그
       * 길은 이 기능이 있기 전과 똑같이 동작한다.
       */
      /*
       * **서버가 실제로 한 말을 적는다.** 앞에서는 `e.message` 뿐이었는데,
       * imapflow 는 태그 붙은 NO/BAD 마다 `Command failed` 라는 **같은 상수
       * 문자열**을 던진다. 운영에서 이 줄이 넷 나왔지만 전부 그 한 문장이라
       * 원인이 서버 쪽인지 우리가 보낸 명령의 모양인지 가릴 수 없었고,
       * 그것을 가리는 데 19시간이 갔다.
       */
      console.warn(
        `[poll] 미리 받기 실패 account=${m.accountId} uid=${m.messageId}: ` +
          imapErrorDetail(e),
      );
      if (streak >= PREFETCH_FAIL_STREAK) {
        console.warn(
          `[poll] 미리 받기 ${streak}연속 실패 — 이번 수집은 여기서 접는다`,
        );
        break;
      }
    }
  }

  /*
   * 몇 통을 얼마 만에 받았는지 남긴다. **이 줄이 없으면 미리 받기가 수집을
   * 늦추고 있는지 아무도 모른다** — 겉으로는 수집이 조용히 느려질 뿐이라
   * 원인을 이 기능으로 되짚을 단서가 없다. 한 줄이라도 항상 찍는다.
   */
  console.log(
    `[poll] 본문 미리 받기 ${done}/${targets.length}통 · 담김 ${stored}` +
      (tooBig ? ` · 큼 ${tooBig}` : "") +
      (failed ? ` · 실패 ${failed}` : "") +
      (skipped ? ` · 건너뜀 ${skipped}` : "") +
      ` · ${Date.now() - started}ms`,
  );
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
