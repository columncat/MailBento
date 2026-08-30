import { and, eq, lt, sql } from "drizzle-orm";

import { checkpointWal, db, schema } from "./db";
import type { Account } from "./db/schema";
import { parseImapView } from "./providers/imap";
import type { MailMessageDetail } from "./providers/types";

/**
 * 열어 본 메일 본문의 캐시 — SQLite(디스크).
 *
 * 메일을 열 때마다 IMAP 연결을 열고 RFC822 원문을 통째로 받아 재파싱하면
 * 같은 메일을 두 번째 열어도 처음과 똑같이 느리다. 한 번 받은 본문을 남겨 두고
 * 두 번째부터는 IMAP 을 아예 치지 않는다.
 *
 * 메모리 Map 이 아니라 디스크인 이유: 컨테이너가 재시작하면 Map 은 비어서
 * 캐시가 사실상 한 세션짜리였다. 본문은 어차피 다시 받아 오면 그만이라
 * 잃어버려도 정합성에는 영향이 없지만, 안 잃어버리면 더 빠르다.
 *
 * **사람이 연 메일만 담긴다.** 미리 받아 두지 않는다 — 자동 수집을 안 하는
 * 결정(mail-poller 는 봉투만 받는다)은 그대로다.
 */

const C = schema.messageBodyCache;

/** 담아 둘 최대 통수. 넘으면 마지막으로 쓰인 지 오래된 것부터 버린다. */
const MAX_ENTRIES = 100;

/**
 * 통당 상한. 이걸 없애면 data: 로 그림이 인라인된 한 통이 캐시를 통째로 먹는다
 * (100통 × 1MB = 100MB 가 디스크 상한이 된다).
 */
const MAX_BYTES = 1_000_000;

/**
 * 30일이 지난 본문은 버린다.
 *
 * 캐시에 왜 TTL 이 있냐면 — 키의 messageId 가 IMAP UID 이기 때문이다. UID 는
 * 메일함이 다시 만들어지면(UIDVALIDITY 변경) 처음부터 다시 매겨져 **다른 메일에
 * 재사용될 수 있다.** 그러면 캐시가 엉뚱한 본문을 내준다. 영영 남지 않게 창을
 * 닫아 두는 것. 지우지 마라.
 *
 * (같은 계정에서 **메일함이 바뀌는** 경우는 이걸로 못 막는다. 그건 즉시
 * 터지므로 아래 viewFingerprint 로 따로 막는다.)
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * detail 에 담긴 JSON 의 모양 번호.
 * MailMessageDetail 의 모양이 바뀌면 올려라 — 옛 모양으로 담긴 행은 읽지 않고
 * 버린다. 필드가 하나 빠진 본문이 "받아온 것"인 척 나가는 것을 막는다.
 */
const FORMAT = 1;

/**
 * 이 뷰가 지금 보고 있는 **메일함의 지문**. 담을 때 적고, 꺼낼 때 견준다.
 *
 * 무엇을 넣었나 —
 *  - `folder`: UID 는 메일함마다 따로 매겨진다. 뷰의 query 를
 *    `folder:보낸메일함` 으로 고치면 계정 id 는 그대로인 채 UID 가 가리키는
 *    메일이 통째로 바뀐다. 이게 이 지문이 존재하는 이유다.
 *  - `host` · `port` · `user`: UID 공간은 "어느 서버의 어느 계정의 어느
 *    메일함" 까지 가야 뜻이 선다. 지금 스키마에서는 기존 계정의 자격증명을
 *    고칠 길이 없지만(PATCH 스키마에 없고 IMAP 폼은 새 계정 전용), 언젠가
 *    그 길이 열려도 이 비교가 알아서 막는다. 값 자체는 이미 accounts 에 있는
 *    것이라 이 표에 새로 새는 정보는 없다.
 *
 * 무엇을 뺐나 —
 *  - `from:` `subject:` `unseen` 같은 **거르개**. 이것들은 목록에 어떤 UID 가
 *    **뜨는지**를 정할 뿐, 어느 UID 가 어느 메일인지는 바꾸지 않는다. 지문에
 *    넣으면 거르개를 한 글자 고칠 때마다 그 뷰의 캐시가 통째로 날아간다 —
 *    얻는 안전은 없고 잃는 속도만 있다.
 *  - 비밀번호. 바꿔도 같은 메일함의 같은 메일이다.
 *
 * JSON 배열로 잇는 이유는 구분자가 값 안에 들어 있어도 두 지문이 겹치지 않기
 * 때문이다(메일함 이름에는 아무 글자나 올 수 있다).
 */
function viewFingerprint(account: Account): string {
  const { folder } = parseImapView(account.query);
  return JSON.stringify([
    account.imapHost ?? "",
    account.imapPort ?? 0,
    account.imapUsername ?? "",
    folder,
  ]);
}

const rowWhere = (accountId: number, messageId: string) =>
  and(eq(C.accountId, accountId), eq(C.messageId, messageId));

/**
 * 본문을 캐시에 담는다 (upsert).
 *
 * 같은 메일을 두 요청이 동시에 열 수 있으므로 upsert 로 쓰고, 넣기와 버리기를
 * 한 트랜잭션에 묶는다 — 넣은 직후 다른 요청의 버리기가 끼어들어 방금 넣은
 * 것을 세지 않은 채 정리하는 일이 없게.
 *
 * 계정 id 가 아니라 **계정 행**을 받는다. 지문을 여기서 직접 뽑기 위해서다 —
 * 부르는 쪽에 맡기면 언젠가 한 곳이 빠뜨린다.
 */
export function rememberDetail(
  account: Account,
  messageId: string,
  detail: MailMessageDetail,
): void {
  const json = JSON.stringify(detail);
  const bytes = Buffer.byteLength(json);
  if (bytes > MAX_BYTES) return;

  const accountId = account.id;
  const view = viewFingerprint(account);
  const now = Date.now();

  db.transaction((tx) => {
    tx.insert(C)
      .values({
        accountId,
        messageId,
        view,
        format: FORMAT,
        detail: json,
        bytes,
        storedAt: now,
        usedAt: now,
      })
      .onConflictDoUpdate({
        target: [C.accountId, C.messageId],
        set: {
          view,
          format: FORMAT,
          detail: json,
          bytes,
          storedAt: now,
          usedAt: now,
        },
      })
      .run();

    // 낡은 것 먼저 (UID 재사용 위험). 개수 상한과 무관하게 항상 턴다.
    tx.delete(C).where(lt(C.storedAt, now - TTL_MS)).run();

    // 그러고도 넘치면 마지막으로 쓰인 지 오래된 것부터.
    // LIMIT -1 OFFSET n = "최신 n개를 뺀 나머지 전부" (SQLite 관용구).
    tx.delete(C)
      .where(
        sql`(${C.accountId}, ${C.messageId}) IN (
          SELECT ${C.accountId}, ${C.messageId} FROM ${C}
          ORDER BY ${C.usedAt} DESC
          LIMIT -1 OFFSET ${MAX_ENTRIES}
        )`,
      )
      .run();
  });
}

/**
 * 캐시에서 본문을 꺼낸다. 없거나 낡았거나 **다른 메일함의 것**이면 null —
 * 부르는 쪽이 IMAP 에서 받아 온다.
 *
 * 읽음·표식은 여기서 오지 않는다. 담긴 JSON 의 unread/mark 는 담을 당시의
 * 값이라 이미 낡았을 수 있고, 부르는 쪽이 message_flags 에서 읽어 덮어 얹는다.
 */
export function peekDetail(
  account: Account,
  messageId: string,
): MailMessageDetail | null {
  const accountId = account.id;
  const row = db.select().from(C).where(rowWhere(accountId, messageId)).get();
  if (!row) return null;

  const now = Date.now();
  const drop = () => {
    db.delete(C).where(rowWhere(accountId, messageId)).run();
    return null;
  };

  // 담을 때와 다른 메일함을 보고 있다 → 이 UID 는 더 이상 이 본문이 아니다.
  // 여기서 행을 지우지는 않는다. 부르는 쪽이 곧 지금 메일함의 본문을 같은 키에
  // 덮어쓰고(upsert), 그때까지도 이 행은 어떤 지문과도 안 맞아 나갈 수 없다.
  // 읽기 한 번에 쓰기를 붙일 이유가 없다. (설정에서 뷰를 고치는 길은 계정
  // PATCH 가 그 계정의 행을 따로 턴다 — forgetAccountDetails.)
  if (row.view !== viewFingerprint(account)) return null;

  if (row.format !== FORMAT) return drop();
  if (now - row.storedAt > TTL_MS) return drop();

  let detail: MailMessageDetail;
  try {
    const parsed = JSON.parse(row.detail) as MailMessageDetail;
    // 손으로 건드렸거나 반쯤 쓰인 행을 본문인 척 내보내지 않는다
    if (!parsed || typeof parsed.id !== "string") return drop();
    detail = parsed;
  } catch {
    return drop();
  }

  // LRU 는 "마지막으로 담은" 이 아니라 "마지막으로 쓰인" 순서다 — 꺼낼 때도 올린다.
  // (storedAt 은 건드리지 않는다. 자주 열어 봤다고 본문이 새것이 되지는 않는다.)
  db.update(C).set({ usedAt: now }).where(rowWhere(accountId, messageId)).run();

  return detail;
}

export interface DetailCacheStats {
  /** 담겨 있는 통수. */
  count: number;
  /** detail JSON 바이트 합. 파일 크기가 아니라 담긴 본문의 크기다. */
  bytes: number;
}

/** 지금 몇 통 · 몇 바이트가 담겨 있나. 설정 화면이 보여 준다. */
export function detailCacheStats(): DetailCacheStats {
  const row = db
    .select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(${C.bytes}), 0)`,
    })
    .from(C)
    .get();
  return { count: row?.count ?? 0, bytes: row?.bytes ?? 0 };
}

/**
 * 캐시를 통째로 비운다. 지운 양을 돌려준다.
 *
 * 본문 캐시만 지우는 길이 사람에게 있어야 한다 — 없으면 뭔가 이상할 때
 * 할 수 있는 일이 "계정을 통째로 지우거나 30일 기다리기" 뿐이고, 계정을 지우면
 * 보관함의 source_account_id 까지 null 이 되는 대가를 치른다.
 *
 * 공간을 파일에서 실제로 돌려받는 것은 부르는 쪽(라우트)의 VACUUM 이다 —
 * 행을 지워도 SQLite 파일은 줄지 않는다.
 */
export function clearDetailCache(): DetailCacheStats {
  const before = detailCacheStats();
  db.delete(C).run();
  return before;
}

/**
 * 한 계정(뷰)의 본문을 버린다. 지운 통수.
 *
 * 뷰의 query 가 바뀌면 부른다. **정합성을 위해서가 아니다** — 그건 위의 지문
 * 비교가 이미 막는다. 여기서 지우는 이유는 공간과 잔류물이다: 이제 영영 적중할
 * 수 없게 된 옛 메일함의 본문이 최대 30일 동안 디스크에 남아 있을 이유가 없다.
 */
export function forgetAccountDetails(accountId: number): number {
  const res = db.delete(C).where(eq(C.accountId, accountId)).run();
  /*
   * 지운 바이트를 `-wal` 에서도 걷어낸다.
   *
   * `secure_delete` 는 **`.db` 만** 씻는다. 지운 본문은 `-wal` 에 평문으로 남고,
   * 재 보니 계정을 통째로 지운 뒤에도 `.db` 0건 / `-wal` 121건이었다. 그 파일을
   * 실제로 비우는 것은 **TRUNCATE 체크포인트뿐**이다 — `journal_size_limit` 을
   * 걸어 봤지만 PASSIVE 체크포인트로는 한 바이트도 안 줄었다(둘 다 121건).
   * 깨끗한 종료(`close()`)는 파일을 통째로 지우지만, 컨테이너가 갑자기 죽으면
   * 그 길이 없다.
   *
   * 여기서만 친다. 통마다의 LRU 축출에서 치면 메일을 열 때마다 WAL 을 다시 쓰게
   * 되는데, 이 캐시를 만든 이유가 바로 그 왕복을 줄이는 것이었다. 그쪽에서 밀려난
   * 본문은 다음 체크포인트에 덮이거나 설정의 "본문 캐시 비우기" 로 걷힌다 —
   * 그것도 TRUNCATE 를 친다.
   */
  if (res.changes > 0) checkpointWal();
  return res.changes;
}
