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

export async function fetchInboxFromClient(
  client: ImapFlow,
  limit: number,
): Promise<MailMessage[]> {
  const lock = await client.getMailboxLock("INBOX");
  try {
    const status = await client.status("INBOX", { messages: true });
    const total = status.messages ?? 0;
    if (total === 0) return [];

    const from = Math.max(1, total - limit + 1);
    const range = `${from}:${total}`;

    const messages: MailMessage[] = [];
    for await (const msg of client.fetch(range, {
      envelope: true,
      flags: true,
      uid: true,
      internalDate: true,
    })) {
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
): Promise<number | null> {
  const status = await client.status("INBOX", { unseen: true });
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
): Promise<MailMessageDetail> {
  const lock = await client.getMailboxLock("INBOX");
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
      fetchInboxFromClient(c, limit),
    );
  },
  async fetchUnreadCount(account: Account): Promise<number | null> {
    return withImapConnection(
      basicCredsFromAccount(account),
      fetchUnreadCountFromClient,
    );
  },
  async fetchMessage(
    account: Account,
    messageId: string,
  ): Promise<MailMessageDetail> {
    const uid = parseInt(messageId, 10);
    if (!Number.isFinite(uid)) throw new Error("유효하지 않은 message ID");
    return withImapConnection(basicCredsFromAccount(account), (c) =>
      fetchMessageFromClient(c, uid),
    );
  },
};
