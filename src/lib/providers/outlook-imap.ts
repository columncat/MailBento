import { eq } from "drizzle-orm";

import { decrypt, encrypt } from "../crypto";
import { db, schema } from "../db";
import type { Account } from "../db/schema";
import { env } from "../env";
import {
  fetchInboxFromClient,
  fetchMessageFromClient,
  fetchUnreadCountFromClient,
  withImapConnection,
} from "./imap";
import type { MailMessage, MailMessageDetail, MailProvider } from "./types";

export const MS_IMAP_SCOPES = [
  "https://outlook.office.com/IMAP.AccessAsUser.All",
  "offline_access",
  "openid",
  "email",
  "profile",
];

export const OUTLOOK_IMAP_HOST = "outlook.office365.com";
export const OUTLOOK_IMAP_PORT = 993;

const tokenEndpoint = () =>
  `https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0/token`;
const authorizeEndpoint = () =>
  `https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0/authorize`;

function requireConfig() {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new Error(
      "MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET 가 .env.local 에 설정되어야 합니다.",
    );
  }
  return {
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
  };
}

export function buildImapAuthorizeUrl(state: string): string {
  const { clientId } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: env.MICROSOFT_IMAP_REDIRECT_URI,
    response_mode: "query",
    scope: MS_IMAP_SCOPES.join(" "),
    state,
    prompt: "select_account",
  });
  return `${authorizeEndpoint()}?${params.toString()}`;
}

interface MsTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export async function exchangeImapCodeForTokens(
  code: string,
): Promise<MsTokenResponse> {
  const { clientId, clientSecret } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: env.MICROSOFT_IMAP_REDIRECT_URI,
    grant_type: "authorization_code",
    scope: MS_IMAP_SCOPES.join(" "),
  });
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `Microsoft IMAP token exchange failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json();
}

async function refreshTokens(refreshToken: string): Promise<MsTokenResponse> {
  const { clientId, clientSecret } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: MS_IMAP_SCOPES.join(" "),
  });
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `Microsoft IMAP token refresh failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json();
}

export function parseIdToken(idToken: string): {
  email: string;
  displayName: string | null;
} {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("id_token format invalid");
  const json = Buffer.from(payload, "base64url").toString("utf8");
  const claims = JSON.parse(json) as {
    email?: string;
    preferred_username?: string;
    name?: string;
    upn?: string;
  };
  const email =
    claims.email || claims.preferred_username || claims.upn || "";
  if (!email) throw new Error("id_token 에 email claim 이 없습니다");
  return { email, displayName: claims.name ?? null };
}

async function getValidAccessToken(account: Account): Promise<string> {
  if (!account.refreshTokenEnc) {
    throw new Error("Refresh token 이 없습니다. 계정을 다시 연결해주세요.");
  }
  const nowSec = Math.floor(Date.now() / 1000);

  if (
    account.accessTokenEnc &&
    account.expiresAt &&
    account.expiresAt > nowSec + 60
  ) {
    return decrypt(account.accessTokenEnc);
  }

  const refreshToken = decrypt(account.refreshTokenEnc);
  const tokens = await refreshTokens(refreshToken);

  await db
    .update(schema.accounts)
    .set({
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : account.refreshTokenEnc,
      expiresAt: nowSec + tokens.expires_in,
      updatedAt: new Date(),
    })
    .where(eq(schema.accounts.id, account.id))
    .run();

  return tokens.access_token;
}

function connectOpts(account: Account, token: string) {
  if (!account.imapUsername) {
    throw new Error("IMAP username (이메일) 이 누락되었습니다.");
  }
  return {
    host: account.imapHost ?? OUTLOOK_IMAP_HOST,
    port: account.imapPort ?? OUTLOOK_IMAP_PORT,
    user: account.imapUsername,
    accessToken: token,
  };
}

export const outlookImapProvider: MailProvider = {
  async fetchInbox(account: Account, limit: number): Promise<MailMessage[]> {
    const token = await getValidAccessToken(account);
    return withImapConnection(connectOpts(account, token), (c) =>
      fetchInboxFromClient(c, limit),
    );
  },
  async fetchUnreadCount(account: Account): Promise<number | null> {
    const token = await getValidAccessToken(account);
    return withImapConnection(
      connectOpts(account, token),
      fetchUnreadCountFromClient,
    );
  },
  async fetchMessage(
    account: Account,
    messageId: string,
  ): Promise<MailMessageDetail> {
    const uid = parseInt(messageId, 10);
    if (!Number.isFinite(uid)) throw new Error("유효하지 않은 message ID");
    const token = await getValidAccessToken(account);
    return withImapConnection(connectOpts(account, token), (c) =>
      fetchMessageFromClient(c, uid),
    );
  },
};
