import { NextResponse, type NextRequest } from "next/server";

import { verifySession } from "@/lib/auth-crypto";

/**
 * Edge-runtime 미들웨어 — DB 접근 X, bcrypt X.
 * 세션 쿠키 검증만 수행. auto-login 등 DB 기록은 /api/auth/auto-renew 에서 처리.
 */

const PUBLIC_PREFIXES = [
  "/login",
  "/api/login",
  "/api/auth/auto-renew",
  "/_next",
  "/favicon",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p),
  );
}

export async function middleware(req: NextRequest) {
  // 인증 비활성 → 통과 (backward compat)
  if (!process.env.AUTH_PASSWORD) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  // 1. 세션 쿠키 검증
  const sessionToken = req.cookies.get("mb_session")?.value;
  if (sessionToken) {
    const session = await verifySession(sessionToken);
    if (session) return NextResponse.next();
  }

  // 2. remember 쿠키로 auto-renew 가능?
  const rememberToken = req.cookies.get("mb_remember")?.value;
  if (rememberToken) {
    const remember = await verifySession(rememberToken);
    if (remember) {
      // /api/auth/auto-renew 로 리다이렉트 → 거기서 DB log + 새 세션 쿠키 + 원래 URL 로 복귀
      const renewUrl = new URL("/api/auth/auto-renew", req.url);
      renewUrl.searchParams.set("to", pathname + req.nextUrl.search);
      return NextResponse.redirect(renewUrl);
    }
  }

  // 3. 둘 다 실패 → 로그인 페이지
  const loginUrl = new URL("/login", req.url);
  if (pathname !== "/") {
    loginUrl.searchParams.set("from", pathname + req.nextUrl.search);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 정적 자산은 매칭 제외
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)"],
};
