import { and, eq } from "drizzle-orm";
import { google } from "googleapis";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { encrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { makeGoogleOAuth2 } from "@/lib/providers/gmail";

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

  if (oauthError) return redirectWithError(req, oauthError);

  const cookieStore = await cookies();
  const savedState = cookieStore.get("oauth_state_google")?.value;
  cookieStore.delete("oauth_state_google");

  if (!code || !state || !savedState || state !== savedState) {
    return redirectWithError(req, "invalid_state");
  }

  try {
    const oauth2 = makeGoogleOAuth2();
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.access_token) return redirectWithError(req, "no_access_token");
    oauth2.setCredentials(tokens);

    const userInfo = await google
      .oauth2({ version: "v2", auth: oauth2 })
      .userinfo.get();
    const email = userInfo.data.email;
    const displayName = userInfo.data.name ?? email ?? "Gmail";
    if (!email) return redirectWithError(req, "no_email");

    const existing = await db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.provider, "gmail"),
          eq(schema.accounts.email, email),
        ),
      )
      .get();

    const base = {
      provider: "gmail" as const,
      displayName,
      email,
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : (existing?.refreshTokenEnc ?? null),
      expiresAt: tokens.expiry_date
        ? Math.floor(tokens.expiry_date / 1000)
        : null,
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(schema.accounts)
        .set(base)
        .where(eq(schema.accounts.id, existing.id))
        .run();
    } else {
      // 새 계정은 그리드 맨 뒤에 추가
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
