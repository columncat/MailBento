import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 답변 속 장부 항목(`[[ledger:…]]`)을 그릴 재료.
 *
 * 이 앱은 장부를 모른다 — 자격 증명도 없고, 줄 이유도 없다. 이미 에이전트
 * 다리를 거쳐 대화하고 있으니 같은 길로 받아 간다. 다리가 여는 것은 **읽기**
 * 하나뿐이다. 미들웨어가 이 경로를 지키므로 로그인하지 않으면 오지 못한다.
 *
 * MailBento 와 MemoBento 에 같은 파일이 있다.
 */

const AGENT_URL = process.env.AGENT_URL?.trim();
const AGENT_TOKEN = process.env.AGENT_TOKEN?.trim();
const TIMEOUT_MS = 8000;

/** `?ids=a,b` — 그릴 항목들. */
export async function GET(req: Request) {
  if (!AGENT_URL || !AGENT_TOKEN) {
    return NextResponse.json({ error: "에이전트가 설정되지 않았습니다" }, { status: 503 });
  }
  const ids = new URL(req.url).searchParams.get("ids") ?? "";
  if (!ids) return NextResponse.json({ entries: [] });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(new URL(`/ledger?ids=${encodeURIComponent(ids)}`, AGENT_URL), {
      headers: { authorization: `Bearer ${AGENT_TOKEN}` },
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
