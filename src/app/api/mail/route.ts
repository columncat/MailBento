import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { fetchInboxesGrouped } from "@/lib/providers/imap";
import type { InboxFetchResult } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

export async function GET() {
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

  return NextResponse.json({ inboxes, fetchedAt: Date.now() });
}
