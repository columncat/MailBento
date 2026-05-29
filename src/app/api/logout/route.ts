import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import {
  REMEMBER_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";

async function clearCookiesAndRedirect(req: NextRequest) {
  const c = await cookies();
  c.delete(SESSION_COOKIE_NAME);
  c.delete(REMEMBER_COOKIE_NAME);
  return NextResponse.redirect(new URL("/login", req.url));
}

export async function POST(req: NextRequest) {
  return clearCookiesAndRedirect(req);
}

// GET 으로도 호출 가능 (단순 링크에서)
export async function GET(req: NextRequest) {
  return clearCookiesAndRedirect(req);
}
