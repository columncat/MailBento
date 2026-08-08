import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 에이전트 설정 프록시.
 *
 * 브라우저가 BentoAgent 를 직접 부르지 않는다 — 공유 토큰이 화면에 실리면
 * 안 되고, 이 앱의 로그인을 그대로 경계로 쓰고 싶다. 미들웨어가 이 경로를
 * 지키므로 로그인하지 않으면 여기까지 오지 못한다.
 *
 * 토큰 값 자체는 어느 방향으로도 돌려주지 않는다. 들어 있는지와 어떤
 * 종류인지만 오간다.
 */

const AGENT_URL = process.env.AGENT_URL?.trim();
const AGENT_TOKEN = process.env.AGENT_TOKEN?.trim();

const TIMEOUT_MS = 10_000;

const patchSchema = z.object({
  claudeOauthToken: z.string().trim().max(4000).optional(),
  anthropicApiKey: z.string().trim().max(4000).optional(),
  discordEnabled: z.boolean().optional(),
  discordToken: z.string().trim().max(4000).optional(),
  discordOwnerId: z.string().trim().max(64).optional(),
  model: z.string().trim().max(120).optional(),
});

function unconfigured() {
  return NextResponse.json(
    { error: "에이전트가 설정되지 않았습니다 (AGENT_URL / AGENT_TOKEN)" },
    { status: 503 },
  );
}

async function call(method: string, body?: unknown) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(new URL("/config", AGENT_URL), {
      method,
      headers: {
        authorization: `Bearer ${AGENT_TOKEN}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    return NextResponse.json(text ? JSON.parse(text) : {}, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: `에이전트에 닿지 못했습니다: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  if (!AGENT_URL || !AGENT_TOKEN) return unconfigured();
  return call("GET");
}

export async function POST(req: Request) {
  if (!AGENT_URL || !AGENT_TOKEN) return unconfigured();
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "값이 올바르지 않습니다" }, { status: 400 });
  }
  return call("POST", parsed.data);
}
