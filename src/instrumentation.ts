/**
 * 서버가 뜰 때 한 번 도는 곳.
 *
 * 여기서 IMAP 을 직접 부르지 않는다. `instrumentation` 은 Edge 런타임용으로도
 * 컴파일되는데, 런타임 가드(`NEXT_RUNTIME`)는 **정적 분석을 막지 못한다** —
 * mailparser 가 딸려 들어가 `Can't resolve 'stream'` 으로 빌드가 깨진다.
 *
 * 그래서 무거운 것은 Node 라우트에 두고, 여기서는 시간에 맞춰 그 라우트를
 * 부르기만 한다. Edge 번들에 남는 것은 `fetch` 뿐이다.
 */

const INTERVAL_MS = 10 * 60 * 1000;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 같은 프로세스 안의 라우트만 이 값을 안다. 미들웨어를 지나야 하므로
  // 공개 경로로 두되, 이 토큰이 실제 자물쇠다.
  // node:crypto 를 import 하면 Edge 번들이 깨진다. globalThis.crypto 는
  // 두 런타임 모두에 있다.
  process.env.INTERNAL_POLL_TOKEN ??= globalThis.crypto.randomUUID();
  const token = process.env.INTERNAL_POLL_TOKEN;
  const port = process.env.PORT ?? "3000";
  const url = `http://127.0.0.1:${port}/api/internal/poll`;

  const tick = async () => {
    try {
      await fetch(url, { method: "POST", headers: { "x-poll-token": token } });
    } catch (e) {
      console.error("[poll] 호출 실패:", e instanceof Error ? e.message : e);
    }
  };

  // 기동 직후 한 번. 컨테이너를 막 올렸을 때 10분을 기다릴 이유가 없다.
  setTimeout(() => void tick(), 8000);
  setInterval(() => void tick(), INTERVAL_MS);
  console.log(`[poll] ${INTERVAL_MS / 60000}분마다 메일 자동 수집`);
}
