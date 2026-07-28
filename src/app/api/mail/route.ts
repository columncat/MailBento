import { NextResponse } from "next/server";

import { getAppConfig } from "@/lib/app-config";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import {
  getMailCache,
  refreshMailCache,
  revalidateInBackground,
  type MailPayload,
} from "@/lib/mail-cache";
import { archiveIdsBySource } from "@/lib/archive-server";
import { loadFlags } from "@/lib/message-flags";
import { fetchInboxesGrouped } from "@/lib/providers/imap";
import type { InboxFetchResult } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

/** IMAP 조회 → 캐시에 넣을 원본 payload (표식은 여기서 섞지 않는다). */
async function fetchFresh(): Promise<MailPayload> {
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

/**
 * 캐시된 원본에 앱 내부 표식(읽음/마크)을 덮어씌운다.
 * 표식은 DB 라서 **캐시를 무효화하지 않아도** 즉시 반영된다.
 */
function withFlags(payload: MailPayload): MailPayload {
  const flags = loadFlags(payload.inboxes.map((i) => i.account.id));
  // 보관 여부는 표식과 달리 하나도 없을 때도 확인해야 한다 — 아래에서 조기
  // 반환하지 않는 이유다.
  const archived = archiveIdsBySource();
  if (flags.size === 0 && archived.size === 0) return payload;

  const inboxes = payload.inboxes.map((inbox) => {
    let readLocally = 0;
    const messages = inbox.messages.map((m) => {
      const key = `${inbox.account.id}:${m.id}`;
      const archiveId = archived.get(key) ?? null;
      const f = flags.get(key);
      if (!f) return { ...m, archiveId };
      if (m.unread && f.read) readLocally++;
      return { ...m, unread: m.unread && !f.read, mark: f.mark, archiveId };
    });
    // 서버 기준 안읽음 수에서 앱에서 읽음 처리한 만큼 뺀다 (음수 방지)
    const unreadCount =
      inbox.unreadCount == null
        ? inbox.unreadCount
        : Math.max(0, inbox.unreadCount - readLocally);
    return { ...inbox, messages, unreadCount };
  });

  return { ...payload, inboxes };
}

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("force") === "1";
  const ttlMs = getAppConfig().mailCacheSeconds * 1000;
  const cache = getMailCache();

  // 캐시가 없거나, 강제 새로고침이거나, 캐시를 끈 경우 → 새 결과를 기다린다
  if (force || !cache || ttlMs <= 0) {
    const payload = await refreshMailCache(fetchFresh);
    return NextResponse.json({ ...withFlags(payload), cached: false, stale: false });
  }

  const stale = Date.now() - cache.fetchedAt >= ttlMs;
  if (stale) {
    // 만료돼도 버리지 않는다 — 낡은 값을 바로 주고 뒤에서 갱신
    revalidateInBackground(fetchFresh);
  }

  return NextResponse.json({ ...withFlags(cache), cached: true, stale });
}
