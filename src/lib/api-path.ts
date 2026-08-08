/**
 * 하위 경로 배포에서 API 주소 앞에 붙일 것.
 *
 * Next 는 `<Link>` 와 `router.push` 와 정적 자산에는 basePath 를 알아서
 * 붙여 준다. **`fetch` 는 손대지 않는다.** 그래서 `/memo` 아래에 얹은 앱이
 * `fetch("/api/notebooks")` 를 부르면 도메인 뿌리로 나가 404 를 받는다.
 *
 * 브라우저가 아니라 서버에서 도는 코드에서는 필요 없다 — 라우트 핸들러끼리는
 * 이미 basePath 가 벗겨진 경로로 오간다. 이 함수는 브라우저 쪽에서만 쓴다.
 *
 * 값이 비어 있으면(대부분의 배포) 받은 것을 그대로 돌려준다.
 */

const BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

export function apiPath(path: string): string {
  if (!BASE) return path;
  // 절대 경로에만 붙인다. 상대 경로나 전체 URL 은 부르는 쪽이 뜻이 있어 쓴 것이다.
  if (!path.startsWith("/")) return path;
  // 두 번 붙는 것을 막는다.
  if (path === BASE || path.startsWith(`${BASE}/`)) return path;
  return `${BASE}${path}`;
}

/** `fetch` 를 그대로 쓰되 주소만 고쳐 준다. 호출부는 이름만 바꾸면 된다. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiPath(path), init);
}
