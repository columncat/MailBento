import { agentGet } from "@/lib/agent-get";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 채팅창 `+` 로 붙일 메일·메모의 후보. `?kind=mail|memo&q=…`
 *
 * 두 앱 모두 다리에게 묻는다. 메일함은 메모를, 메모함은 메일을 모르는데,
 * 한쪽만 직접 읽게 하면 두 채팅창의 파일이 갈라진다.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind") === "memo" ? "memo" : "mail";
  const query = (q.get("q") ?? "").slice(0, 200);
  return agentGet(`/refs?kind=${kind}&q=${encodeURIComponent(query)}`);
}
