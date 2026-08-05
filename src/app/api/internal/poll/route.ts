import { NextResponse } from "next/server";

import { pollOnce } from "@/lib/mail-poller";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 자동 수집 한 번. `instrumentation` 의 타이머가 부른다.
 *
 * 미들웨어를 지나야 해서 공개 경로에 두지만, 같은 프로세스만 아는 토큰이
 * 실제 자물쇠다. 밖에서 부르면 401 이다.
 */
export async function POST(req: Request) {
  const expected = process.env.INTERNAL_POLL_TOKEN;
  if (!expected || req.headers.get("x-poll-token") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await pollOnce();
  return NextResponse.json(result);
}
