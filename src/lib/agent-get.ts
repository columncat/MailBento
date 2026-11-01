import { NextResponse } from "next/server";

/**
 * 에이전트 다리에 요청 하나를 그대로 넘긴다 — `/api/agent/mails`·`/refs`·`/prefs` 가 쓴다.
 *
 * 브라우저는 다리를 직접 부르지 않는다. 토큰이 화면에 실리지 않고, 이 앱의
 * 로그인이 그대로 경계가 된다 (미들웨어가 `/api/agent/*` 를 지킨다).
 *
 * MailBento 와 MemoBento 에 같은 파일이 있다.
 */

const AGENT_URL = process.env.AGENT_URL?.trim();
const AGENT_TOKEN = process.env.AGENT_TOKEN?.trim();
const TIMEOUT_MS = 15000;

export async function agentGet(path: string, init?: RequestInit): Promise<NextResponse> {
  if (!AGENT_URL || !AGENT_TOKEN) {
    return NextResponse.json({ error: "에이전트가 설정되지 않았습니다" }, { status: 503 });
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(new URL(path, AGENT_URL), {
      ...init,
      headers: {
        authorization: `Bearer ${AGENT_TOKEN}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
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
