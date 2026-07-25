import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import type { MessageMark } from "./db/schema";

/**
 * 앱 내부 메일 표식 (읽음 / 마크).
 *
 * IMAP 서버의 \Seen · \Flagged 는 **건드리지 않는다** — MailBento 는 읽기 전용
 * 대시보드이고, 다른 메일 클라이언트의 상태를 바꾸지 않기 위해서다.
 * 대신 (account_id, message_id) 별로 로컬 상태를 두고 표시할 때 덮어씌운다.
 */

export interface MessageFlag {
  read: boolean;
  mark: MessageMark | null;
}

export const EMPTY_FLAG: MessageFlag = { read: false, mark: null };

const key = (accountId: number, messageId: string) => `${accountId}:${messageId}`;

/** 여러 계정의 표식을 한 번에 읽어 `accountId:messageId` 맵으로 돌려준다. */
export function loadFlags(accountIds: number[]): Map<string, MessageFlag> {
  const out = new Map<string, MessageFlag>();
  if (accountIds.length === 0) return out;

  const rows = db
    .select()
    .from(schema.messageFlags)
    .where(inArray(schema.messageFlags.accountId, accountIds))
    .all();

  for (const r of rows) {
    out.set(key(r.accountId, r.messageId), {
      read: r.read === 1,
      mark: r.mark ?? null,
    });
  }
  return out;
}

/** IMAP UID 는 메일함마다 따로 매겨지므로 반드시 accountId 와 함께 조회한다. */
const flagWhere = (accountId: number, messageId: string) =>
  and(
    eq(schema.messageFlags.accountId, accountId),
    eq(schema.messageFlags.messageId, messageId),
  );

export function getFlag(accountId: number, messageId: string): MessageFlag {
  const row = db
    .select()
    .from(schema.messageFlags)
    .where(flagWhere(accountId, messageId))
    .get();
  if (!row) return { ...EMPTY_FLAG };
  return { read: row.read === 1, mark: row.mark ?? null };
}

/**
 * 표식 갱신 (upsert). 넘기지 않은 필드는 그대로 둔다.
 * read/mark 가 모두 기본값이 되면 행을 지워 테이블이 무한정 자라지 않게 한다.
 */
export function setFlag(
  accountId: number,
  messageId: string,
  patch: { read?: boolean; mark?: MessageMark | null },
): MessageFlag {
  const cur = getFlag(accountId, messageId);
  const next: MessageFlag = {
    read: patch.read ?? cur.read,
    mark: patch.mark !== undefined ? patch.mark : cur.mark,
  };

  if (!next.read && next.mark === null) {
    db.delete(schema.messageFlags)
      .where(flagWhere(accountId, messageId))
      .run();
    return next;
  }

  db.insert(schema.messageFlags)
    .values({
      accountId,
      messageId,
      read: next.read ? 1 : 0,
      mark: next.mark,
    })
    .onConflictDoUpdate({
      target: [schema.messageFlags.accountId, schema.messageFlags.messageId],
      set: {
        read: next.read ? 1 : 0,
        mark: next.mark,
        updatedAt: new Date(),
      },
    })
    .run();

  return next;
}
