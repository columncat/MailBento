import { NextResponse } from "next/server";

import { getAppConfig } from "@/lib/app-config";
import { db, schema } from "@/lib/db";
import { fetchAllInboxes } from "@/lib/mail-fetch";
import {
  getMailCache,
  refreshMailCache,
  revalidateInBackground,
  type MailPayload,
} from "@/lib/mail-cache";
import { archiveIdsBySource } from "@/lib/archive-server";
import { loadFlags } from "@/lib/message-flags";
import type { InboxFetchResult } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

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
  const cache = getMailCache();

  /*
   * 캐시는 만료되지 않는다.
   *
   * 새로 가져오는 일은 서버가 10분마다 스스로 한다(lib/mail-poller). 화면은
   * 그 결과를 보기만 하면 되고, TTL 을 두면 화면을 여는 사람마다 IMAP 을
   * 두드리게 된다. 갱신은 성공했을 때만 갈아끼우므로 낡은 값이 보일지언정
   * 비지는 않는다.
   *
   * 손으로 누르는 새로고침(force=1)만 즉시 다시 가져온다.
   */
  if (force || !cache) {
    const payload = await refreshMailCache(fetchAllInboxes);
    return NextResponse.json({ ...withFlags(payload), cached: false, stale: false });
  }

  return NextResponse.json({ ...withFlags(cache), cached: true, stale: false });
}
