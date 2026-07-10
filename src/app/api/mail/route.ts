import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { getProvider, isProviderImplemented } from "@/lib/providers";
import type { InboxFetchResult } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

/** 계정 하나가 걸려도 25s 안에 실패시켜 전체 504 를 막는다. */
const ACCOUNT_TIMEOUT_MS = 25000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} 시간 초과 (${ms}ms)`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t)) as Promise<T>;
}

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

      const started = Date.now();
      try {
        const provider = getProvider(account.provider);
        const { messages, unreadCount } = await withTimeout(
          (async () => {
            const msgs = await provider.fetchInbox(
              account,
              env.MESSAGES_PER_BOX,
            );
            let uc: number | null = null;
            if (provider.fetchUnreadCount) {
              uc = await provider.fetchUnreadCount(account).catch(() => null);
            }
            // null 이면 fetched 메시지에서 계산 (쿼리 뷰 / IMAP 등)
            if (uc === null) uc = msgs.filter((m) => m.unread).length;
            return { messages: msgs, unreadCount: uc };
          })(),
          ACCOUNT_TIMEOUT_MS,
          `${account.displayName} 가져오기`,
        );

        return { ...base, messages, unreadCount, error: null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "알 수 없는 오류";
        console.warn(
          `[mail] account #${account.id} "${account.displayName}" 실패 (${Date.now() - started}ms): ${msg}`,
        );
        return { ...base, messages: [], unreadCount: null, error: msg };
      }
    }),
  );

  return NextResponse.json({ inboxes: results, fetchedAt: Date.now() });
}
