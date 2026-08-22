import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 답변 속 메모를 그리고 만지는 길.
 *
 * 이 앱은 메모를 모른다 — MemoBento 의 자격 증명도 없고, 줄 이유도 없다. 대신
 * 이미 에이전트 다리를 거쳐 대화하고 있으니, 답변 안의 `[[memo:…]]` 를 그릴
 * 재료와 체크를 켜고 끄는 것도 같은 길로 간다.
 *
 * 다리가 여는 것은 **읽기와 체크 두 가지**뿐이다. 만들거나 지우는 길은 없다.
 * 미들웨어가 이 경로를 지키므로 로그인하지 않으면 여기까지 오지 못한다.
 */

const AGENT_URL = process.env.AGENT_URL?.trim();
const AGENT_TOKEN = process.env.AGENT_TOKEN?.trim();
const TIMEOUT_MS = 8000;

function unconfigured() {
  return NextResponse.json({ error: "에이전트가 설정되지 않았습니다" }, { status: 503 });
}

async function forward(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<NextResponse> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(new URL(path, AGENT_URL), {
      method: init.method,
      headers: {
        authorization: `Bearer ${AGENT_TOKEN}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctl.signal,
    });
    const text = await res.text();
    return NextResponse.json(text ? JSON.parse(text) : {}, { status: res.status });
  } catch {
    return NextResponse.json({ error: "에이전트에 닿지 못했습니다" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

/** `?ids=a,b` — 그릴 메모들. */
export async function GET(req: Request) {
  if (!AGENT_URL || !AGENT_TOKEN) return unconfigured();
  const ids = new URL(req.url).searchParams.get("ids") ?? "";
  if (!ids) return NextResponse.json({ memos: [] });
  return forward(`/memos?ids=${encodeURIComponent(ids)}`, { method: "GET" });
}

const toggleSchema = z.object({
  id: z.string().min(1).max(64),
  done: z.boolean(),
});

/** 체크 켜고 끄기. */
export async function POST(req: Request) {
  if (!AGENT_URL || !AGENT_TOKEN) return unconfigured();
  const parsed = toggleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "id 와 done 이 필요합니다" }, { status: 400 });
  }
  return forward("/memos/toggle", { method: "POST", body: parsed.data });
}
