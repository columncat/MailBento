import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import {
  encryptSession,
  verifySession,
  type SessionPayload,
} from "@/lib/auth-crypto";
import {
  REMEMBER_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_TTL_LONG,
  isAuthEnabled,
  logLogin,
  nowSeconds,
  sessionCookieOptions,
} from "@/lib/auth";

export async function GET(req: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const cookieStore = await cookies();
  const rememberToken = cookieStore.get(REMEMBER_COOKIE_NAME)?.value;
  if (!rememberToken) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const verified = await verifySession(rememberToken);
  if (!verified) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // DB 에 "auto" 로그인 기록
  const ua = (await headers()).get("user-agent") ?? "unknown";
  try {
    await logLogin({ type: "auto", success: true, userAgent: ua });
  } catch {
    /* 로그 실패해도 로그인 자체는 진행 */
  }

  // 새 세션 쿠키 발급
  const now = nowSeconds();
  const payload: SessionPayload = {
    iat: now,
    exp: now + SESSION_TTL_LONG,
    remember: true,
  };
  const token = await encryptSession(payload);
  cookieStore.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(true));

  // 원래 가려던 URL 로 복귀 (오픈 리다이렉트 방지 — same-origin 체크)
  const to = req.nextUrl.searchParams.get("to") || "/";
  const safeTo = to.startsWith("/") && !to.startsWith("//") ? to : "/";
  return NextResponse.redirect(new URL(safeTo, req.url));
}
