import { cookies } from "next/headers";

import {
  REMEMBER_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { redirectTo } from "@/lib/redirect";

async function clearCookiesAndRedirect() {
  const c = await cookies();
  c.delete(SESSION_COOKIE_NAME);
  c.delete(REMEMBER_COOKIE_NAME);
  // 303 — 로그아웃 뒤에는 무슨 메서드로 들어왔든 /login 을 GET 해야 한다
  return redirectTo("/login", 303);
}

export async function POST() {
  return clearCookiesAndRedirect();
}

// GET 으로도 호출 가능 (단순 링크에서)
export async function GET() {
  return clearCookiesAndRedirect();
}
