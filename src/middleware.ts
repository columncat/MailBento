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
  /**
   * 자동 수집이 자기 자신을 부르는 경로.
   * 같은 프로세스만 아는 토큰이 자물쇠라 로그인은 필요 없다.
   */
  "/api/internal/poll",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p),
  );
}

/**
 * 이 요청이 화면 이동인가, 코드가 부르는 것인가.
 *
 * 브라우저의 `fetch` 는 리다이렉트를 **알아서 따라간다.** 그래서 세션이 끊긴
 * 뒤 `/api/…` 를 부르면 로그인 페이지 HTML 이 200 으로 도착하고, 받는 쪽은
 * 그걸 JSON 으로 읽다가 터진다:
 *
 *   Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 *
 * 화면에는 로그인하라는 말 대신 저 문장이 뜬다. 더 나쁜 경우도 있었다 —
 * 파싱 실패를 빈 객체로 뭉개는 자리에서는 메모함 목록이 통째로 비어, 자료가
 * 지워진 것처럼 보였다.
 *
 * 그래서 API 에는 리다이렉트를 주지 않는다. 401 과 JSON 을 준다. 받는 쪽이
 * 무엇을 만났는지 알 수 있고, HTML 이 JSON 파서에 닿을 길이 사라진다.
 */
function isApi(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function unauthorized() {
  return NextResponse.json(
    { error: "로그인이 필요합니다", code: "unauthenticated" },
    { status: 401, headers: { "cache-control": "no-store" } },
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
  //
  // 화면 이동이면 갱신을 거쳐 원래 자리로 돌려보낸다. API 는 그럴 수 없다 —
  // 리다이렉트를 따라간 fetch 는 갱신 라우트가 마지막에 내보내는 HTML 을
  // 받아 들고 JSON 인 줄 알고 읽는다. 401 을 주고 화면이 다시 부르게 한다.
  const rememberToken = req.cookies.get("mb_remember")?.value;
  if (rememberToken) {
    const remember = await verifySession(rememberToken);
    if (remember) {
      if (isApi(pathname)) return unauthorized();
      // /api/auth/auto-renew 로 리다이렉트 → 거기서 DB log + 새 세션 쿠키 + 원래 URL 로 복귀
      const renewUrl = new URL("/api/auth/auto-renew", req.url);
      renewUrl.searchParams.set("to", pathname + req.nextUrl.search);
      return NextResponse.redirect(renewUrl);
    }
  }

  // 3. 둘 다 실패
  if (isApi(pathname)) return unauthorized();

  const loginUrl = new URL("/login", req.url);
  if (pathname !== "/") {
    loginUrl.searchParams.set("from", pathname + req.nextUrl.search);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  /*
   * 확장자 제외를 넣지 않는다.
   *
   * 부정 전방탐색 안의 `.*\.(?:png|…)` 에는 끝 앵커가 없어서 확장자가 경로
   * **어디에** 있어도 걸린다. `/api/mail/1/5.png` 가 미들웨어를 통째로 건너뛰어
   * 로그인 없이 메일 본문이 읽혔다 — 라우트가 `messageId="5.png"` 로 그대로
   * 매치되기 때문이다. 앵커를 붙여도 끝에 `.png` 를 달면 그만이라 소용없다.
   *
   * 정적 자산은 아래 PUBLIC_PREFIXES 의 "/_next" · "/favicon" 이 이미
   * 통과시키므로 여기서 뺄 이유가 없다.
   */
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
