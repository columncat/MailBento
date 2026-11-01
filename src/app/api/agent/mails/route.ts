import { agentGet } from "@/lib/agent-get";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 대화 속 메일(`[[mail:…]]`)을 그릴 재료. `?ids=3:184467,…`
 *
 * 메모함은 메일을 모르고, 메일함 쪽 채팅창도 같은 파일이라 둘 다 다리를 거친다.
 * 다리가 여는 것은 **읽기** 하나뿐이다.
 */
export async function GET(req: Request) {
  const ids = new URL(req.url).searchParams.get("ids") ?? "";
  if (!ids) return Response.json({ mails: [] });
  return agentGet(`/mails?ids=${encodeURIComponent(ids)}`);
}
