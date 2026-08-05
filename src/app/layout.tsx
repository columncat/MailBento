import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "MailBento",
  description: "여러 메일 계정을 한눈에 보는 개인 대시보드",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ko"
      // 서버가 보내는 기본값. CSS 는 다크가 밑바탕이라 클래스가 없는 순간은
      // 그대로 다크로 보인다 — 아래 스크립트가 localStorage 로 고쳐 쓰기 전까지의
      // 그 짧은 틈을 없애려고 라이트를 미리 박아 둔다.
      className="theme-forest mode-light"
      suppressHydrationWarning
    >
      <head>
        {/* 첫 페인트 전에 테마를 확정한다. <body> 에 두면 그 전에 한 번
            다크로 칠해진 화면이 보인다. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('mailbento.theme')||'forest';var m=localStorage.getItem('mailbento.mode');if(m!=='dark'&&m!=='light')m='light';document.documentElement.className='theme-'+t+' mode-'+m;}catch(e){}})();`,
          }}
        />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@latest/dist/web/variable/pretendardvariable.css"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body className="relative z-10">
        {children}
      </body>
    </html>
  );
}
