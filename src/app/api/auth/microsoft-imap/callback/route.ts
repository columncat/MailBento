import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { encrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import {
  exchangeImapCodeForTokens,
  OUTLOOK_IMAP_HOST,
  OUTLOOK_IMAP_PORT,
  parseIdToken,
} from "@/lib/providers/outlook-imap";

function redirectWithError(req: NextRequest, reason: string) {
  return NextResponse.redirect(
    new URL(`/settings?auth_error=${encodeURIComponent(reason)}`, req.url),
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (oauthError) {
    return redirectWithError(req, errorDescription ?? oauthError);
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get("oauth_state_microsoft_imap")?.value;
  cookieStore.delete("oauth_state_microsoft_imap");

  if (!code || !state || !savedState || state !== savedState) {
    return redirectWithError(req, "invalid_state");
  }

  try {
    const tokens = await exchangeImapCodeForTokens(code);
    if (!tokens.access_token) return redirectWithError(req, "no_access_token");
    if (!tokens.id_token) return redirectWithError(req, "no_id_token");

    const { email, displayName } = parseIdToken(tokens.id_token);
    const finalDisplayName = displayName ?? email;

    const existing = await db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.provider, "outlook_imap"),
          eq(schema.accounts.email, email),
        ),
      )
      .get();

    const nowSec = Math.floor(Date.now() / 1000);
    const base = {
      provider: "outlook_imap" as const,
      displayName: finalDisplayName,
      email,
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : (existing?.refreshTokenEnc ?? null),
      expiresAt: nowSec + tokens.expires_in,
      // IMAP 접속 정보 — Office 365 고정값. 사용자에 따라 향후 커스텀 호스트가 필요해지면 분기.
      imapHost: OUTLOOK_IMAP_HOST,
      imapPort: OUTLOOK_IMAP_PORT,
      imapUsername: email,
      imapPasswordEnc: null, // XOAUTH2 — 비밀번호 없음
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(schema.accounts)
        .set(base)
        .where(eq(schema.accounts.id, existing.id))
        .run();
    } else {
      const all = await db
        .select({ position: schema.accounts.position })
        .from(schema.accounts)
        .all();
      const maxPos = all.reduce((m, r) => Math.max(m, r.position), -1);
      await db
        .insert(schema.accounts)
        .values({ ...base, position: maxPos + 1 })
        .run();
    }

    return NextResponse.redirect(new URL("/", req.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return redirectWithError(req, message);
  }
}
