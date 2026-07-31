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
  // 프로토콜 상대(`//evil.com`)는 다른 사이트로 나간다
  const safe = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return new NextResponse(null, { status, headers: { Location: safe } });
}
