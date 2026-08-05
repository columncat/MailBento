/**
 * IMAP 조회 → 캐시에 넣을 원본 payload.
 *
 * 라우트 안에 있던 것을 꺼냈다. 서버측 자동 수집(mail-poller)도 같은 것을
 * 써야 하고, 두 벌이 되면 한쪽만 고치는 날이 온다.
 */
import { db, schema } from "./db";
import { env } from "./env";
import type { MailPayload } from "./mail-cache";
import { fetchInboxesGrouped } from "./providers/imap";
import type { InboxFetchResult } from "./providers/types";

/** IMAP 조회 → 캐시에 넣을 원본 payload (표식은 여기서 섞지 않는다). */
export async function fetchAllInboxes(): Promise<MailPayload> {
  const accounts = await db
    .select()
    .from(schema.accounts)
    .orderBy(schema.accounts.position)
    .all();

  // 같은 자격증명(계정)은 연결 1개 공유 → 뷰마다 따로 연결하지 않음
  const fetched = await fetchInboxesGrouped(accounts, env.MESSAGES_PER_BOX);

  const inboxes: InboxFetchResult[] = accounts.map((account) => {
    const r = fetched.get(account.id) ?? {
      messages: [],
      unreadCount: null,
      error: "결과 없음",
    };
    if (r.error) {
      console.warn(
        `[mail] account #${account.id} "${account.displayName}": ${r.error}`,
      );
    }
    return {
      account: {
        id: account.id,
        provider: account.provider,
        displayName: account.displayName,
        email: account.email,
        iconUrl: account.iconUrl,
        displayEmail: account.displayEmail,
        webUrl: account.webUrl,
      },
      messages: r.messages,
      unreadCount: r.unreadCount,
      error: r.error,
    };
  });

  return { inboxes, fetchedAt: Date.now() };
}
