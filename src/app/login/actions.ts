"use server";

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

export type LoginFormState = { error?: string } | null;

export async function loginAction(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") === "on";
  const to = String(formData.get("to") ?? "/");
  const ua = (await headers()).get("user-agent") ?? "unknown";

  if (!password) {
    return { error: "비밀번호를 입력하세요" };
  }

  if (!verifyPassword(password)) {
    try {
      await logLogin({ type: "manual", success: false, userAgent: ua });
    } catch {
      /* */
    }
    return { error: "비밀번호가 틀렸습니다" };
  }

  try {
    await logLogin({ type: "manual", success: true, userAgent: ua });
  } catch {
    /* */
  }

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
  const safeTo = to.startsWith("/") && !to.startsWith("//") ? to : "/";
  redirect(safeTo);
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  cookieStore.delete(REMEMBER_COOKIE_NAME);
  redirect("/login");
}
