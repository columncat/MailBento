import { and, eq } from "drizzle-orm";
import { google, type gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

import { decrypt, encrypt } from "../crypto";
import { db, schema } from "../db";
import type { Account } from "../db/schema";
import { env } from "../env";
import { plainTextToSafeHtml, sanitizeEmailHtml } from "../sanitize";
import type {
  MailAddress,
  MailMessage,
  MailMessageDetail,
  MailProvider,
} from "./types";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export function makeGoogleOAuth2(): OAuth2Client {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 가 .env.local 에 설정되어야 합니다.",
    );
  }
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

function clientForAccount(account: Account): OAuth2Client {
  const client = makeGoogleOAuth2();
  client.setCredentials({
    access_token: account.accessTokenEnc
      ? decrypt(account.accessTokenEnc)
      : undefined,
    refresh_token: account.refreshTokenEnc
      ? decrypt(account.refreshTokenEnc)
      : undefined,
    expiry_date: account.expiresAt ? account.expiresAt * 1000 : undefined,
  });

  client.on("tokens", (tokens) => {
    if (!tokens.access_token) return;
    // 같은 (provider, email) 의 모든 row 에 새 토큰 반영 — "복제 뷰" 도 함께 갱신됨
    db.update(schema.accounts)
      .set({
        accessTokenEnc: encrypt(tokens.access_token),
        refreshTokenEnc: tokens.refresh_token
          ? encrypt(tokens.refresh_token)
          : account.refreshTokenEnc,
        expiresAt: tokens.expiry_date
          ? Math.floor(tokens.expiry_date / 1000)
          : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.accounts.provider, account.provider),
          eq(schema.accounts.email, account.email),
        ),
      )
      .run();
  });

  return client;
}

function parseFrom(raw: string): { name: string | null; email: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim() };
  return { name: null, email: raw.trim() };
}

/** "Alice <a@x>, Bob <b@y>" → [{name,email}, ...] (큰따옴표 안 쉼표 무시). */
function parseAddressList(raw: string): MailAddress[] {
  if (!raw) return [];
  const items: string[] = [];
  let inQuotes = false;
  let cur = "";
  for (const ch of raw) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      if (cur.trim()) items.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) items.push(cur.trim());
  return items.map(parseFrom);
}

/** Gmail payload tree 를 재귀로 훑어 주어진 mimeType 의 첫 본문 텍스트를 반환. */
function findBodyPart(
  part: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string,
): string | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf-8");
  }
  for (const sub of part.parts ?? []) {
    const found = findBodyPart(sub, mimeType);
    if (found) return found;
  }
  return null;
}

export const gmailProvider: MailProvider = {
  async fetchInbox(account: Account, limit: number): Promise<MailMessage[]> {
    const auth = clientForAccount(account);
    const gmail = google.gmail({ version: "v1", auth });

    // 커스텀 query 가 있으면 그걸로 검색, 없으면 INBOX 기본
    const q = account.query?.trim();
    const list = await gmail.users.messages.list({
      userId: "me",
      maxResults: limit,
      ...(q ? { q } : { labelIds: ["INBOX"] }),
    });

    const ids = list.data.messages ?? [];
    if (ids.length === 0) return [];

    const details = await Promise.all(
      ids.map((m) =>
        gmail.users.messages.get({
          userId: "me",
          id: m.id!,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"],
        }),
      ),
    );

    return details.map((res) => {
      const msg = res.data;
      const headers = msg.payload?.headers ?? [];
      const subject =
        headers.find((h) => h.name === "Subject")?.value ?? "(제목 없음)";
      const fromRaw = headers.find((h) => h.name === "From")?.value ?? "";
      const from = parseFrom(fromRaw);
      const dateHeader = headers.find((h) => h.name === "Date")?.value;
      const receivedAt = msg.internalDate
        ? Number(msg.internalDate)
        : dateHeader
          ? new Date(dateHeader).getTime()
          : Date.now();
      const unread = (msg.labelIds ?? []).includes("UNREAD");

      return {
        id: msg.id!,
        subject,
        from,
        receivedAt,
        snippet: msg.snippet ?? null,
        unread,
      } satisfies MailMessage;
    });
  },

  async fetchUnreadCount(account: Account): Promise<number | null> {
    // 커스텀 query 뷰는 unread 정확 카운트가 모호하므로 null → 호출자가 fetched 메시지에서 계산
    if (account.query?.trim()) return null;
    const auth = clientForAccount(account);
    const gmail = google.gmail({ version: "v1", auth });
    const res = await gmail.users.labels.get({ userId: "me", id: "INBOX" });
    return res.data.messagesUnread ?? null;
  },

  async fetchMessage(
    account: Account,
    messageId: string,
  ): Promise<MailMessageDetail> {
    const auth = clientForAccount(account);
    const gmail = google.gmail({ version: "v1", auth });

    const res = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });
    const msg = res.data;
    const headers = msg.payload?.headers ?? [];
    const headerVal = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? "";

    const subject = headerVal("Subject") || "(제목 없음)";
    const from = parseFrom(headerVal("From"));
    const to = parseAddressList(headerVal("To"));
    const cc = parseAddressList(headerVal("Cc"));
    const receivedAt = msg.internalDate
      ? Number(msg.internalDate)
      : headerVal("Date")
        ? new Date(headerVal("Date")).getTime()
        : Date.now();
    const unread = (msg.labelIds ?? []).includes("UNREAD");

    const htmlRaw = findBodyPart(msg.payload, "text/html");
    const text = findBodyPart(msg.payload, "text/plain");
    const html = htmlRaw
      ? sanitizeEmailHtml(htmlRaw)
      : text
        ? plainTextToSafeHtml(text)
        : null;

    return {
      id: msg.id ?? messageId,
      subject,
      from,
      receivedAt,
      snippet: msg.snippet ?? null,
      unread,
      to,
      cc,
      html,
      text,
    };
  },
};
