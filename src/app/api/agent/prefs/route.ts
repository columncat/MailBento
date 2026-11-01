import { NextResponse } from "next/server";
import { z } from "zod";

import { agentGet } from "@/lib/agent-get";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 에이전트의 알림·안내문 설정 — 설정 화면의 "알림과 안내문" 칸이 쓴다.
 *
 * `/api/agent/config` 와 따로 둔다. 그쪽은 저장하면 에이전트가 다시 뜨고,
 * 이쪽은 다음 요청부터 바로 먹는다. 글 길이는 다리가 다시 잰다 — 여기서는
 * 터무니없이 큰 것만 막는다.
 */
const patchSchema = z.object({
  mailAlerts: z.boolean().optional(),
  triageCriteria: z.string().max(20000).nullable().optional(),
  extraInstructions: z.string().max(20000).nullable().optional(),
});

export async function GET() {
  return agentGet("/prefs");
}

export async function POST(req: Request) {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "고칠 값의 모양이 맞지 않습니다" }, { status: 400 });
  }
  return agentGet("/prefs", { method: "POST", body: JSON.stringify(parsed.data) });
}
