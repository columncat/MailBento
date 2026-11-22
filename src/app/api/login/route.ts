import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  REMEMBER_COOKIE_NAME,
  REMEMBER_TTL,
  SESSION_COOKIE_NAME,
  SESSION_TTL_LONG,
  SESSION_TTL_SHORT,
  isAuthEnabled,
  logLogin,
  nowSeconds,
  rememberCookieOptions,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";
import { encryptSession } from "@/lib/auth-crypto";
import { AUTH_MISCONFIGURED_MESSAGE, authMode } from "@/lib/auth-mode";
import {
  FAIL_DELAY_MS,
  checkLoginAllowed,
  noteLoginFailure,
  noteLoginSuccess,
} from "@/lib/login-throttle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 사람이 아닌 클라이언트용 로그인.
 *
 * 화면 로그인은 서버 액션(`login/actions.ts`)이라 폼 인코딩과 액션 ID 를 알아야
 * 부를 수 있다. MCP 서버나 스크립트가 그걸 흉내내게 두면 Next 내부 규약에
 * 묶이므로, 같은 검사·같은 기록·같은 쿠키를 쓰는 JSON 입구를 따로 둔다.
 * (`middleware.ts` 의 `PUBLIC_PREFIXES` 에 이미 자리가 있다.)
 *
 * 돌려주는 것은 세션 쿠키뿐이다 — 비밀번호도, 키도 응답에 담지 않는다.
 */

const bodySchema = z.object({
  password: z.string().min(1),
  /** 90일짜리 remember 쿠키까지 받을지. 오래 도는 에이전트에 쓴다. */
  remember: z.boolean().optional(),
});

export async function POST(req: Request) {
  /*
   * 설정이 빠진 배포는 미들웨어가 이미 503 으로 막는다. 그래도 여기서 한 번 더
   * 본다 — "인증 꺼짐" 과 "설정 빠짐" 을 섞어 authDisabled 를 돌려주면, MCP 같은
   * 클라이언트가 쿠키 없이 진행해도 되는 줄 안다.
   */
  if (authMode() === "misconfigured") {
    return NextResponse.json(
      { error: AUTH_MISCONFIGURED_MESSAGE, code: "auth-misconfigured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (!isAuthEnabled()) {
    // AUTH_DISABLED=1 로 일부러 끈 배포에서만 온다. 쿠키 없이 그대로 진행하면 된다.
    return NextResponse.json({ ok: true, authDisabled: true });
  }

  // 횟수로 막는다. 지연만으로는 동시 요청이 겹쳐 사라진다.
  const gate = checkLoginAllowed(req);
  if (!gate.ok) {
    return NextResponse.json(
      { error: `시도가 너무 많습니다. ${gate.retryAfter}초 뒤에 다시 시도하세요.` },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "비밀번호가 필요합니다" }, { status: 400 });
  }

  const ua = (await headers()).get("user-agent") ?? "unknown";

  if (!verifyPassword(parsed.data.password)) {
    try {
      await logLogin({ type: "manual", success: false, userAgent: ua });
    } catch {
      /* 기록 실패가 응답을 바꾸면 안 된다 */
    }
    noteLoginFailure(req);
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json(
      { error: "비밀번호가 틀렸습니다" },
      { status: 401 },
    );
  }

  try {
    await logLogin({ type: "manual", success: true, userAgent: ua });
  } catch {
    /* */
  }

  noteLoginSuccess(req);

  const remember = parsed.data.remember ?? false;
  const now = nowSeconds();
  const cookieStore = await cookies();

  cookieStore.set(
    SESSION_COOKIE_NAME,
    await encryptSession({
      iat: now,
      exp: now + (remember ? SESSION_TTL_LONG : SESSION_TTL_SHORT),
      remember,
    }),
    sessionCookieOptions(remember),
  );

  if (remember) {
    cookieStore.set(
      REMEMBER_COOKIE_NAME,
      await encryptSession({ iat: now, exp: now + REMEMBER_TTL, remember: true }),
      rememberCookieOptions(),
    );
  }

  return NextResponse.json({ ok: true, remember });
}
