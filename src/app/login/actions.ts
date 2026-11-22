"use server";

import { safePath } from "@/lib/redirect";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  encryptSession,
  type SessionPayload,
} from "@/lib/auth-crypto";
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
import { authMode } from "@/lib/auth-mode";
import {
  FAIL_DELAY_MS,
  checkLoginAllowed,
  noteLoginFailure,
  noteLoginSuccess,
} from "@/lib/login-throttle";

export type LoginFormState = { error?: string } | null;

export async function loginAction(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  // 설정이 빠진 경우는 미들웨어가 먼저 막는다. 혹시 닿아도 "꺼짐" 처럼 굴지 않는다.
  if (authMode() === "misconfigured") {
    return { error: "인증 설정이 없어 로그인할 수 없습니다. 관리자에게 알리세요." };
  }
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") === "on";
  const to = String(formData.get("to") ?? "/");
  const h = await headers();
  const ua = h.get("user-agent") ?? "unknown";

  /*
   * `/api/login` 과 같은 횟수 제한을 건다.
   *
   * 예전에는 JSON 입구에만 있었다. 그런데 서버 액션도 액션 ID 만 알면 스크립트로
   * 얼마든지 부를 수 있어서, 막힌 쪽 대신 이쪽으로 돌아가면 제한이 없었다.
   * 두 입구가 같은 통(lib/login-throttle.ts)을 써야 우회가 안 된다.
   */
  const gate = checkLoginAllowed(h);
  if (!gate.ok) {
    return { error: `시도가 너무 많습니다. ${gate.retryAfter}초 뒤에 다시 시도하세요.` };
  }

  if (!password) {
    return { error: "비밀번호를 입력하세요" };
  }

  if (!verifyPassword(password)) {
    try {
      await logLogin({ type: "manual", success: false, userAgent: ua });
    } catch {
      /* */
    }
    noteLoginFailure(h);
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return { error: "비밀번호가 틀렸습니다" };
  }

  try {
    await logLogin({ type: "manual", success: true, userAgent: ua });
  } catch {
    /* */
  }

  noteLoginSuccess(h);

  // 세션 쿠키 발급
  const now = nowSeconds();
  const sessionTtl = remember ? SESSION_TTL_LONG : SESSION_TTL_SHORT;
  const sessionPayload: SessionPayload = {
    iat: now,
    exp: now + sessionTtl,
    remember,
  };
  const sessionToken = await encryptSession(sessionPayload);

  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_COOKIE_NAME,
    sessionToken,
    sessionCookieOptions(remember),
  );

  if (remember) {
    const rememberPayload: SessionPayload = {
      iat: now,
      exp: now + REMEMBER_TTL,
      remember: true,
    };
    const rememberToken = await encryptSession(rememberPayload);
    cookieStore.set(
      REMEMBER_COOKIE_NAME,
      rememberToken,
      rememberCookieOptions(),
    );
  }

  // same-origin 체크
  const safeTo = safePath(to);
  redirect(safeTo);
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  cookieStore.delete(REMEMBER_COOKIE_NAME);
  redirect("/login");
}
