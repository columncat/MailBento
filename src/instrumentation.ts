/**
 * 서버가 뜰 때 한 번 도는 곳.
 *
 * 메일 자동 수집을 여기서 시작한다. 화면이 열려 있든 말든 컨테이너가 살아
 * 있는 동안 계속 돌아야 하고, 라우트 안에서 시작하면 첫 요청이 올 때까지
 * 아무 일도 일어나지 않는다.
 */
export async function register(): Promise<void> {
  // Edge 런타임에서도 한 번 불린다. IMAP 은 Node 에서만 돈다.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMailPoller } = await import("./lib/mail-poller");
  startMailPoller();
}
