/**
 * Node runtime 전용 인증 유틸 — DB / bcryptjs 사용.
 * 미들웨어에서 직접 import 하지 말 것 (edge 호환 안 됨).
 * 쿠키 crypto 는 lib/auth-crypto.ts 에 분리되어 있음 (edge 호환).
 */

import bcrypt from "bcryptjs";

import { db, schema } from "./db";
import { env } from "./env";

export function isAuthEnabled(): boolean {
  return !!env.AUTH_PASSWORD;
}

/** Plaintext 와 bcrypt 해시 둘 다 자동 감지. timing-safe 비교. */
export function verifyPassword(input: string): boolean {
  const stored = env.AUTH_PASSWORD;
  if (!stored) return false;

  if (
    stored.startsWith("$2a$") ||
    stored.startsWith("$2b$") ||
    stored.startsWith("$2y$")
  ) {
    try {
      return bcrypt.compareSync(input, stored);
    } catch {
      return false;
    }
  }

  // Plaintext: timing-safe 비교 (길이 다르면 fast-fail OK — 비밀번호 길이는 노출 위협 낮음)
  if (input.length !== stored.length) return false;
  let mismatch = 0;
  for (let i = 0; i < stored.length; i++) {
    mismatch |= input.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return mismatch === 0;
}

/** 로그인 기록 한 줄 추가. DELETE 엔드포인트는 의도적으로 없음. */
export async function logLogin(opts: {
  type: "manual" | "auto";
  success: boolean;
  userAgent: string;
}): Promise<void> {
  await db
    .insert(schema.loginLog)
    .values({
      type: opts.type,
      success: opts.success ? 1 : 0,
      userAgent: opts.userAgent.slice(0, 500), // 너무 길면 자름
    })
    .run();
}

// ─────────────────────────────────────────────────────────────
//   세션 / remember 쿠키 정책
// ─────────────────────────────────────────────────────────────

export const SESSION_COOKIE_NAME = "mb_session";
export const REMEMBER_COOKIE_NAME = "mb_remember";

const HOUR = 3600;
const DAY = 24 * HOUR;

/** "remember" 안 한 경우 세션 유효시간 (browser-close 로도 끊김). */
export const SESSION_TTL_SHORT = 4 * HOUR;
/** "remember" 한 경우 세션 유효시간 (browser-close 후 복귀해도 잠시 유효). */
export const SESSION_TTL_LONG = 24 * HOUR;
/** "remember" 쿠키 자체의 유효시간 — 이게 진짜 "자동 로그인" 기간. */
export const REMEMBER_TTL = 90 * DAY;

export function sessionCookieOptions(remember: boolean) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    // remember 한 경우만 maxAge 지정 → 브라우저 재시작 후에도 잠시 유효 (lib/auth-crypto exp 와 같이)
    // 안 한 경우 maxAge 생략 → session cookie (브라우저 종료시 삭제)
    ...(remember ? { maxAge: SESSION_TTL_LONG } : {}),
  };
}

export function rememberCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: REMEMBER_TTL,
  };
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
