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
    <html lang="ko" suppressHydrationWarning>
      <head>
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
        {/* hydration 전에 테마 클래스 적용 — FOUC 방지 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('mailbento.theme')||'forest';var m=localStorage.getItem('mailbento.mode')||'dark';document.documentElement.className='theme-'+t+' mode-'+m;}catch(e){}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
