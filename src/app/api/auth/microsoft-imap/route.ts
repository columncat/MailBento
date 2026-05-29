import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildImapAuthorizeUrl } from "@/lib/providers/outlook-imap";

export async function GET() {
  try {
    const state = randomBytes(32).toString("base64url");
    const cookieStore = await cookies();
    cookieStore.set("oauth_state_microsoft_imap", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return NextResponse.redirect(buildImapAuthorizeUrl(state));
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
