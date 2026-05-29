import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";

import { decrypt } from "../crypto";
import type { Account } from "../db/schema";
import { plainTextToSafeHtml, sanitizeEmailHtml } from "../sanitize";
import type {
  MailAddress,
  MailMessage,
  MailMessageDetail,
  MailProvider,
} from "./types";

export interface ImapConnectOptions {
  host: string;
  port: number;
  user: string;
  pass?: string;
  accessToken?: string;
}

function makeClient(opts: ImapConnectOptions): ImapFlow {
  if (!opts.pass && !opts.accessToken) {
    throw new Error("IMAP: pass 또는 accessToken 중 하나가 필요합니다.");
  }
  return new ImapFlow({
    host: opts.host,
    port: opts.port,
    secure: opts.port === 993,
    auth: opts.accessToken
      ? { user: opts.user, accessToken: opts.accessToken }
      : { user: opts.user, pass: opts.pass! },
    logger: false,
  });
}

export async function withImapConnection<T>(
  opts: ImapConnectOptions,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = makeClient(opts);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function testImapConnection(
  opts: ImapConnectOptions,
): Promise<void> {
  await withImapConnection(opts, async () => {});
}

// ─────────────────────────────────────────────────────────────
//   IMAP "뷰" 쿼리 파서
//   query 필드를 폴더 선택 + 서버사이드 SEARCH 로 해석.
//   토큰(공백 구분, AND): folder:/from:/to:/cc:/subject:(subj:)/
//   body:(text:)/since:YYYY-MM-DD/before:YYYY-MM-DD/unseen/seen,
//   key 없는 단어는 본문(text) 검색. 공백 포함 값은 "..." 로.
// ─────────────────────────────────────────────────────────────

export interface ImapSearchCriteria {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  since?: Date;
  before?: Date;
  seen?: boolean;
}

export interface ImapView {
  folder: string;
  criteria: ImapSearchCriteria | null; // null = 검색 없음 (폴더 최신 N개)
}

function tokenizeQuery(q: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) tokens.push(m[1] ?? m[2]);
  return tokens;
}

export function parseImapView(query?: string | null): ImapView {
  let folder = "INBOX";
  const crit: ImapSearchCriteria = {};
  const bodyParts: string[] = [];
  let hasFilter = false;

  if (query && query.trim()) {
    for (const raw of tokenizeQuery(query.trim())) {
      const idx = raw.indexOf(":");
      const key = idx > 0 ? raw.slice(0, idx).toLowerCase() : "";
      const val = idx > 0 ? raw.slice(idx + 1) : raw;
      switch (key) {
        case "folder":
        case "mailbox":
          if (val) folder = val;
          break;
        case "from":
          crit.from = val;
          hasFilter = true;
          break;
        case "to":
          crit.to = val;
          hasFilter = true;
          break;
        case "cc":
          crit.cc = val;
          hasFilter = true;
          break;
        case "subject":
        case "subj":
          crit.subject = val;
          hasFilter = true;
          break;
        case "body":
        case "text":
          bodyParts.push(val);
          hasFilter = true;
          break;
        case "since": {
          const d = new Date(val);
          if (!Number.isNaN(d.getTime())) {
            crit.since = d;
            hasFilter = true;
          }
          break;
        }
        case "before": {
          const d = new Date(val);
          if (!Number.isNaN(d.getTime())) {
            crit.before = d;
            hasFilter = true;
          }
          break;
        }
        default: {
          const low = raw.toLowerCase();
          if (low === "unseen" || low === "unread") {
            crit.seen = false;
            hasFilter = true;
          } else if (low === "seen" || low === "read") {
            crit.seen = true;
            hasFilter = true;
          } else {
            bodyParts.push(raw);
            hasFilter = true;
          }
        }
      }
    }
    if (bodyParts.length) crit.body = bodyParts.join(" ");
  }

  return { folder, criteria: hasFilter ? crit : null };
}

export async function fetchInboxFromClient(
  client: ImapFlow,
  limit: number,
  query?: string | null,
): Promise<MailMessage[]> {
  const { folder, criteria } = parseImapView(query);
  const lock = await client.getMailboxLock(folder);
  try {
    let source: string;
    let byUid = false;

    if (criteria) {
      const uids = await client.search(criteria, { uid: true });
      if (!uids || uids.length === 0) return [];
      source = uids.slice(-limit).join(","); // 최신(높은 UID) limit개
      byUid = true;
    } else {
      const status = await client.status(folder, { messages: true });
      const total = status.messages ?? 0;
      if (total === 0) return [];
      const from = Math.max(1, total - limit + 1);
      source = `${from}:${total}`;
    }

    const messages: MailMessage[] = [];
    for await (const msg of client.fetch(
      source,
      { envelope: true, flags: true, uid: true, internalDate: true },
      byUid ? { uid: true } : undefined,
    )) {
      const envelope = msg.envelope;
      const fromAddr = envelope?.from?.[0];
      const email = fromAddr?.address ?? "";
      messages.push({
        id: String(msg.uid),
        subject: envelope?.subject ?? "(제목 없음)",
        from: { name: fromAddr?.name?.trim() || null, email },
        receivedAt: msg.internalDate
          ? new Date(msg.internalDate).getTime()
          : Date.now(),
        snippet: null,
        unread: !msg.flags?.has("\\Seen"),
      });
    }

    return messages.reverse();
  } finally {
    lock.release();
  }
}

export async function fetchUnreadCountFromClient(
  client: ImapFlow,
  query?: string | null,
): Promise<number | null> {
  const { folder, criteria } = parseImapView(query);
  // 검색 필터가 있으면 정확한 미읽음 수를 status 로 못 구함 → null (가져온 메시지에서 계산)
  if (criteria) return null;
  const status = await client.status(folder, { unseen: true });
  return status.unseen ?? null;
}

function parsedAddrToMailAddr(
  addr: AddressObject | AddressObject[] | undefined,
): MailAddress[] {
  if (!addr) return [];
  const list = Array.isArray(addr) ? addr : [addr];
  const result: MailAddress[] = [];
  for (const a of list) {
    for (const v of a.value ?? []) {
      result.push({
        name: v.name?.trim() || null,
        email: v.address ?? "",
      });
    }
  }
  return result;
}

export async function fetchMessageFromClient(
  client: ImapFlow,
  uid: number,
  folder = "INBOX",
): Promise<MailMessageDetail> {
  const lock = await client.getMailboxLock(folder);
  try {
    const result = await client.fetchOne(
      String(uid),
      {
        source: true,
        envelope: true,
        flags: true,
        internalDate: true,
        uid: true,
      },
      { uid: true },
    );
    if (!result) {
      throw new Error(`메시지를 찾을 수 없습니다 (UID ${uid})`);
    }

    const source = result.source as Buffer;
    const parsed = await simpleParser(source);

    const fromList = parsedAddrToMailAddr(parsed.from);
    const from = fromList[0] ?? {
      name: null,
      email: "",
    };

    const htmlRaw =
      typeof parsed.html === "string" && parsed.html.length > 0
        ? parsed.html
        : null;
    const text = parsed.text ?? null;
    const html = htmlRaw
      ? sanitizeEmailHtml(htmlRaw)
      : text
        ? plainTextToSafeHtml(text)
        : null;

    return {
      id: String(uid),
      subject:
        parsed.subject ?? result.envelope?.subject ?? "(제목 없음)",
      from,
      receivedAt: result.internalDate
        ? new Date(result.internalDate).getTime()
        : Date.now(),
      snippet: null,
      unread: !result.flags?.has("\\Seen"),
      to: parsedAddrToMailAddr(parsed.to),
      cc: parsedAddrToMailAddr(parsed.cc),
      html,
      text,
    };
  } finally {
    lock.release();
  }
}

// ─────────────────────────────────────────────────────────────
//   provider — basic auth (Naver / 임의 IMAP + app password)
// ─────────────────────────────────────────────────────────────

function basicCredsFromAccount(account: Account): ImapConnectOptions {
  if (
    !account.imapHost ||
    !account.imapPort ||
    !account.imapUsername ||
    !account.imapPasswordEnc
  ) {
    throw new Error(
      "IMAP 자격 증명이 누락되었습니다. 계정을 다시 등록해주세요.",
    );
  }
  return {
    host: account.imapHost,
    port: account.imapPort,
    user: account.imapUsername,
    pass: decrypt(account.imapPasswordEnc),
  };
}

export const imapProvider: MailProvider = {
  async fetchInbox(account: Account, limit: number): Promise<MailMessage[]> {
    return withImapConnection(basicCredsFromAccount(account), (c) =>
      fetchInboxFromClient(c, limit, account.query),
    );
  },
  async fetchUnreadCount(account: Account): Promise<number | null> {
    return withImapConnection(basicCredsFromAccount(account), (c) =>
      fetchUnreadCountFromClient(c, account.query),
    );
  },
  async fetchMessage(
    account: Account,
    messageId: string,
  ): Promise<MailMessageDetail> {
    const uid = parseInt(messageId, 10);
    if (!Number.isFinite(uid)) throw new Error("유효하지 않은 message ID");
    const { folder } = parseImapView(account.query);
    return withImapConnection(basicCredsFromAccount(account), (c) =>
      fetchMessageFromClient(c, uid, folder),
    );
  },
};
