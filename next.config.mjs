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

/**
 * 보안 헤더.
 *
 * 예전에는 하나도 없었다(`X-Powered-By` 뿐). 메일 HTML 을 화면에 그대로 붓는
 * 앱이라, sanitize 를 빠져나온 무언가가 있으면 막아 줄 두 번째 벽이 없었다.
 *
 * CSP 가 일부러 무른 자리와 그 이유:
 *  - script-src 'unsafe-inline' — App Router 가 페이지마다 인라인 스크립트
 *    (`self.__next_f.push(…)`)를 심고, layout.tsx 의 테마 부트 스크립트도 인라인이다.
 *    nonce 로 바꾸려면 모든 페이지가 동적 렌더가 되어야 해서 지금은 하지 않는다.
 *    그래도 외부 스크립트 출처는 `'self'` 하나로 묶인다.
 *  - style-src 'unsafe-inline' — 메일 본문이 `style=` 속성을 그대로 들고 오고
 *    (sanitize.ts 가 남긴다), React·Tailwind 도 style 속성을 쓴다.
 *  - img-src https: — 위젯·계정 아이콘은 사용자가 **아무 https 주소**나 적을 수
 *    있다(예: dashboard-icons 의 svg). 메일 본문의 원격 그림은 이와 별개로
 *    sanitize.ts 가 `/api/mail-image` 프록시로 이미 바꿔 쓴다.
 *  - 글꼴: Pretendard 는 cdn.jsdelivr.net, Instrument Serif·JetBrains Mono 는
 *    Google Fonts(CSS 는 fonts.googleapis.com, 파일은 fonts.gstatic.com) — layout.tsx.
 *
 * 개발 서버(`next dev`)는 eval 과 웹소켓(HMR)을 쓰므로 그때만 연다. 운영
 * 빌드에서는 NODE_ENV=production 이라 이 두 줄이 들어가지 않는다.
 *
 * HSTS 는 여기서 주지 않는다 — 앞단(Cloudflare)이 붙인다.
 */
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  // wttr.in — 시계 위젯(widget-clock.tsx)이 날씨를 브라우저에서 직접 받아 온다.
  `connect-src 'self' https://wttr.in${isDev ? " ws: wss:" : ""}`,
  "media-src 'self' blob:",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // 무엇으로 만든 서버인지 밖에 알릴 이유가 없다.
  poweredByHeader: false,
  /*
   * `/_next/image` 최적화를 끈다. 이 앱은 next/image 를 쓰지 않는데, 라우트는
   * 그대로 살아 있어서 그 경로의 취약점(이미지 최적화 RCE 권고들)이 그대로
   * 노출면이 된다. 꺼 두면 그 라우트가 아예 일을 하지 않는다.
   */
  images: { unoptimized: true },
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      /*
       * `no-referrer` 가 아니라 `same-origin` 이다. no-referrer 면 Chrome 이
       * 같은 출처의 폼 POST 에도 `Origin: null` 을 보내고, 서버 액션의
       * Origin 검사가 진짜 로그인까지 전부 거절한다(카메라 게이트에서 실제로 났다).
       */
      { key: "Referrer-Policy", value: "same-origin" },
      // 다섯 앱이 한 도메인을 나눠 쓰므로 DENY 가 아니라 SAMEORIGIN.
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      // 카메라·마이크·위치를 쓰는 기능이 없다. 붙여 넣기는 이벤트라 권한이 필요 없다.
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      },
    ];
    const cspHeader = { key: "Content-Security-Policy", value: csp };
    return [
      {
        /*
         * 뿌리(대시보드)는 따로 적는다. basePath 가 있으면 뿌리 주소가 `/mail`
         * (끝 빗금 없음)이라 아래의 `/:path(…)` 꼴에 걸리지 않는다 — 실제로
         * 메일 HTML 을 그리는 바로 그 화면에만 헤더가 하나도 없었다.
         */
        source: "/",
        headers: [...common, cspHeader],
      },
      {
        /*
         * 모든 경로. 단 `/api/mail-image` 는 뺀다 — 그 응답은 발신자에게 출처를
         * 흘리지 않으려고 `referrer-policy: no-referrer` 를 스스로 단다(nosniff 도
         * 스스로 단다). 같은 이름의 헤더가 두 번 붙으면 브라우저가 어느 쪽을
         * 따를지 애매해진다.
         */
        source: "/:path((?!api/mail-image).*)",
        headers: common,
      },
      {
        /*
         * 페이지에만 CSP 를 단다. `/api/*` 는 JSON 과 첨부·인라인 그림 같은 파일을
         * 내보내는데, 파일 응답에 페이지용 CSP 가 붙으면 브라우저 내장 뷰어(PDF 등)
         * 가 깨질 수 있다. 그 라우트들은 nosniff 와 content-disposition 으로 따로 지킨다.
         */
        source: "/:path((?!api/).*)",
        headers: [cspHeader],
      },
    ];
  },
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
