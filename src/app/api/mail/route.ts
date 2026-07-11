import { NextResponse } from "next/server";

import { getAppConfig } from "@/lib/app-config";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { getMailCache, setMailCache } from "@/lib/mail-cache";
import { fetchInboxesGrouped } from "@/lib/providers/imap";
import type { InboxFetchResult } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const ttlMs = getAppConfig().mailCacheSeconds * 1000;

  // TTL 안이고 강제 아님 → 캐시 반환 (IMAP 재조회 없음)
  const cache = getMailCache();
  if (!force && ttlMs > 0 && cache && Date.now() - cache.fetchedAt < ttlMs) {
    return NextResponse.json({ ...cache, cached: true });
  }

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

  const payload = { inboxes, fetchedAt: Date.now() };
  setMailCache(payload);
  return NextResponse.json(payload);
}
