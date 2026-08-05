import { NextResponse } from "next/server";

/**
 * 같은 오리진 안에서의 리다이렉트.
 *
 * `NextResponse.redirect(new URL(path, req.url))` 를 쓰면 안 된다.
 * standalone 빌드의 route handler 에서 `req.url` 의 오리진은 요청의 Host 가
 * 아니라 **서버가 바인드한 주소**로 채워진다. 도커에서는 `HOSTNAME=0.0.0.0`
 * 이므로 그대로 절대 URL 을 만들면 브라우저가 `http://0.0.0.0:3000` 으로
 * 끌려간다. (미들웨어는 Next 가 같은 오리진이면 상대 경로로 정규화해 주기
 * 때문에 증상이 route handler 에서만 나타난다.)
 *
 * Location 은 상대 경로여도 된다(RFC 9110 §10.2.2). 브라우저가 현재 오리진을
 * 기준으로 풀어 주므로 LAN·Tailscale·리버스 프록시 중 무엇으로 들어왔든 그대로
 * 따라간다. Host 헤더를 믿고 오리진을 되짜맞추는 방법도 있지만, 그쪽은 헤더
 * 위조로 열린 리다이렉트가 되는 길을 새로 여는 셈이라 쓰지 않는다.
 *
 * @param status 303 은 이어지는 요청을 GET 으로 바꾼다. POST 를 처리한 뒤
 *   페이지로 보낼 때 쓴다. 307 은 메서드를 그대로 유지한다.
 */
export function redirectTo(
  path: string,
  status: 303 | 307 = 307,
): NextResponse {
  const safe = safePath(path);
  return new NextResponse(null, { status, headers: { Location: safe } });
}

/**
 * 같은 오리진 안의 경로인가.
 *
 * `//evil.com` 은 프로토콜 상대 URL 이라 다른 사이트로 나간다. 그리고 브라우저는
 * **역슬래시를 슬래시처럼 읽으므로** `/\evil.com` 도 마찬가지다 — 슬래시만
 * 막으면 샌다. 로그인 직후로 리다이렉트되는 자리라, 가장 믿기 쉬운 순간에
 * 남의 사이트로 보내진다.
 *
 * 그래서 "슬래시로 시작하고, 두 번째 글자가 슬래시도 역슬래시도 아닌 것" 만 통과시킨다.
 */
export function safePath(path: string | null | undefined): string {
  if (!path) return "/";
  if (path === "/") return "/";
  return /^\/[^/\\]/.test(path) ? path : "/";
}
