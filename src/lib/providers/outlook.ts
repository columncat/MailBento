import "isomorphic-fetch";

import { Client } from "@microsoft/microsoft-graph-client";
import { eq } from "drizzle-orm";

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

export const MICROSOFT_SCOPES = ["Mail.Read", "User.Read", "offline_access"];

interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

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

const tokenEndpoint = () =>
  `https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0/token`;
const authorizeEndpoint = () =>
  `https://login.microsoftonline.com/${env.MICROSOFT_TENANT}/oauth2/v2.0/authorize`;

export function buildAuthorizeUrl(state: string): string {
  const { clientId } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: env.MICROSOFT_REDIRECT_URI,
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
    prompt: "select_account",
  });
  return `${authorizeEndpoint()}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
): Promise<MicrosoftTokenResponse> {
  const { clientId, clientSecret } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: env.MICROSOFT_REDIRECT_URI,
    grant_type: "authorization_code",
    scope: MICROSOFT_SCOPES.join(" "),
  });
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `Microsoft token exchange failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json();
}

async function refreshTokens(
  refreshToken: string,
): Promise<MicrosoftTokenResponse> {
  const { clientId, clientSecret } = requireConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: MICROSOFT_SCOPES.join(" "),
  });
  const res = await fetch(tokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `Microsoft token refresh failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json();
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

export async function fetchMicrosoftUserInfo(
  accessToken: string,
): Promise<{ email: string; displayName: string | null }> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Microsoft userinfo failed: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
  };
  const email = data.mail || data.userPrincipalName || "";
  if (!email) throw new Error("Microsoft 계정에서 이메일을 가져오지 못했습니다");
  return { email, displayName: data.displayName ?? null };
}

function makeGraph(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => done(null, accessToken),
  });
}

interface GraphMessage {
  id: string;
  subject: string | null;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime: string;
  bodyPreview: string | null;
  isRead: boolean;
}

interface GraphMessageDetail extends GraphMessage {
  body?: { contentType: "html" | "text"; content: string };
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  ccRecipients?: { emailAddress?: { name?: string; address?: string } }[];
}

function graphAddr(addr?: {
  emailAddress?: { name?: string; address?: string };
}): MailAddress {
  return {
    name: addr?.emailAddress?.name?.trim() || null,
    email: addr?.emailAddress?.address?.trim() ?? "",
  };
}

export const outlookProvider: MailProvider = {
  async fetchInbox(account: Account, limit: number): Promise<MailMessage[]> {
    const token = await getValidAccessToken(account);
    const graph = makeGraph(token);

    const res = await graph
      .api("/me/mailFolders/inbox/messages")
      .top(limit)
      .select("id,subject,from,receivedDateTime,bodyPreview,isRead")
      .orderby("receivedDateTime DESC")
      .get();

    const messages = (res.value ?? []) as GraphMessage[];

    return messages.map((m) => ({
      id: m.id,
      subject: m.subject ?? "(제목 없음)",
      from: graphAddr(m.from),
      receivedAt: new Date(m.receivedDateTime).getTime(),
      snippet: m.bodyPreview,
      unread: !m.isRead,
    }));
  },

  async fetchUnreadCount(account: Account): Promise<number | null> {
    const token = await getValidAccessToken(account);
    const graph = makeGraph(token);
    const res = await graph
      .api("/me/mailFolders/inbox")
      .select("unreadItemCount")
      .get();
    return res.unreadItemCount ?? null;
  },

  async fetchMessage(
    account: Account,
    messageId: string,
  ): Promise<MailMessageDetail> {
    const token = await getValidAccessToken(account);
    const graph = makeGraph(token);

    const m = (await graph
      .api(`/me/messages/${messageId}`)
      .select(
        "id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,isRead,body",
      )
      .get()) as GraphMessageDetail;

    const body = m.body;
    const isHtml = body?.contentType === "html";
    const content = body?.content ?? "";
    const html = isHtml
      ? sanitizeEmailHtml(content)
      : content
        ? plainTextToSafeHtml(content)
        : null;

    return {
      id: m.id,
      subject: m.subject ?? "(제목 없음)",
      from: graphAddr(m.from),
      receivedAt: new Date(m.receivedDateTime).getTime(),
      snippet: m.bodyPreview,
      unread: !m.isRead,
      to: (m.toRecipients ?? []).map(graphAddr),
      cc: (m.ccRecipients ?? []).map(graphAddr),
      html,
      text: isHtml ? null : content || null,
    };
  },
};
