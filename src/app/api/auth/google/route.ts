import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { GOOGLE_SCOPES, makeGoogleOAuth2 } from "@/lib/providers/gmail";

export async function GET() {
  try {
    const oauth2 = makeGoogleOAuth2();

    const state = randomBytes(32).toString("base64url");
    const cookieStore = await cookies();
    cookieStore.set("oauth_state_google", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });

    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // 새 refresh token 강제 발급
      scope: GOOGLE_SCOPES,
      state,
      include_granted_scopes: true,
    });

    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
