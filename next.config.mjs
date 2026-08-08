/**
 * 하위 경로에 얹을 때 쓰는 값.
 *
 * `bento.example.com/mail` 처럼 도메인 하나를 나눠 쓰는 배포에서 필요하다.
 * 앞단에서 경로만 갈라 보내면 앱은 자기가 `/mail` 아래 있다는 것을 모르고
 * `/settings` 같은 절대 경로를 만들어 낸다 — 브라우저는 그걸 도메인 뿌리로
 * 해석해서 엉뚱한 곳으로 간다.
 *
 * **빌드 시점에 박히는 값이다.** 이미지를 만들 때 정해야 하고 나중에
 * 환경변수로 바꿀 수 없다. Next 가 이 값을 산출물 곳곳(정적 자산 주소,
 * 라우트 표, 클라이언트 번들)에 미리 심기 때문이다.
 *
 * 비워 두면 예전처럼 뿌리에서 돈다. 하위 도메인을 쓰는 배포는 건드릴 필요가 없다.
 */
const basePath = (process.env.BASE_PATH ?? "").replace(/\/$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "better-sqlite3",
    "imapflow",
    "mailparser",
    "sanitize-html",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  ...(basePath ? { basePath } : {}),
  env: {
    /*
     * 브라우저 코드에도 알려 준다.
     *
     * Next 는 <Link> 와 router 와 정적 자산에는 접두어를 알아서 붙이지만
     * **fetch 는 손대지 않는다.** `fetch("/api/…")` 는 도메인 뿌리로 가서
     * 404 를 받는다. 그래서 부를 때 직접 붙여야 하고, 그러려면 값이 필요하다.
     */
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
