import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { getProvider, isProviderImplemented } from "@/lib/providers";
import type { InboxFetchResult } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const accounts = await db
    .select()
    .from(schema.accounts)
    .orderBy(schema.accounts.position)
    .all();

  const results = await Promise.all(
    accounts.map(async (account): Promise<InboxFetchResult> => {
      const base = {
        account: {
          id: account.id,
          provider: account.provider,
          displayName: account.displayName,
          email: account.email,
          iconUrl: account.iconUrl,
          displayEmail: account.displayEmail,
          webUrl: account.webUrl,
        },
      };

      if (!isProviderImplemented(account.provider)) {
        return {
          ...base,
          messages: [],
          unreadCount: null,
          error: `${account.provider} 어댑터가 아직 구현되지 않았습니다`,
        };
      }

      try {
        const provider = getProvider(account.provider);
        const messages = await provider.fetchInbox(
          account,
          env.MESSAGES_PER_BOX,
        );
        let unreadCount: number | null = null;
        if (provider.fetchUnreadCount) {
          unreadCount = await provider
            .fetchUnreadCount(account)
            .catch(() => null);
        }
        // null 이면 fetched 메시지에서 계산 (쿼리 뷰 / IMAP 등)
        if (unreadCount === null) {
          unreadCount = messages.filter((m) => m.unread).length;
        }

        return { ...base, messages, unreadCount, error: null };
      } catch (err) {
        return {
          ...base,
          messages: [],
          unreadCount: null,
          error: err instanceof Error ? err.message : "알 수 없는 오류",
        };
      }
    }),
  );

  return NextResponse.json({ inboxes: results, fetchedAt: Date.now() });
}
