"use client";

import { CornerDownLeft } from "lucide-react";

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function NaverLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect width="24" height="24" rx="4" fill="#03C75A" />
      <path fill="#fff" d="M14.13 12.4 9.6 6H6v12h3.87v-6.4L14.4 18H18V6h-3.87z" />
    </svg>
  );
}

function NamuLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/namu.svg" alt="" aria-hidden className={className} />
  );
}

interface SearchEngine {
  key: string;
  /** 검색어 → 이동 URL (나무위키는 path 기반이라 form GET 불가). */
  buildUrl: (q: string) => string;
  placeholder: string;
  home: string;
  Logo: (p: { className?: string }) => React.ReactElement;
  /** 브랜드 컬러 ring (리터럴이어야 Tailwind 가 생성). */
  ringCls: string;
  label: string;
}

const ENGINES: SearchEngine[] = [
  {
    key: "google",
    buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    placeholder: "Google에서 검색…",
    home: "https://www.google.com",
    Logo: GoogleLogo,
    ringCls: "ring-[#4285f4]/40 focus-within:ring-[#4285f4]",
    label: "Google",
  },
  {
    key: "naver",
    buildUrl: (q) =>
      `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`,
    placeholder: "네이버에서 검색…",
    home: "https://www.naver.com",
    Logo: NaverLogo,
    ringCls: "ring-[#03c75a]/40 focus-within:ring-[#03c75a]",
    label: "Naver",
  },
  {
    key: "namu",
    buildUrl: (q) => `https://namu.wiki/w/${encodeURIComponent(q)}`,
    placeholder: "나무위키에서 검색…",
    home: "https://namu.wiki",
    Logo: NamuLogo,
    ringCls: "ring-[#00a495]/40 focus-within:ring-[#00a495]",
    label: "나무위키",
  },
];

export function WidgetSearch() {
  return (
    <div className="flex h-full flex-col gap-2.5 p-5">
      <div className="flex h-6 shrink-0 items-center justify-between">
        <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-(--color-fg-2)">
          Search
        </span>
        <span className="flex items-center gap-1 font-mono text-[10px] text-(--color-fg-4)">
          <CornerDownLeft className="h-2.5 w-2.5" />
          to go
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        {ENGINES.map((e) => (
          <form
            key={e.key}
            onSubmit={(ev) => {
              ev.preventDefault();
              const q = String(new FormData(ev.currentTarget).get("q") ?? "")
                .trim();
              if (!q) return;
              window.open(e.buildUrl(q), "_blank", "noopener");
            }}
            className={`flex flex-1 items-center gap-2.5 rounded-lg bg-(--color-bg-2) px-3 ring-1 transition ${e.ringCls}`}
          >
            <a
              href={e.home}
              target="_blank"
              rel="noreferrer"
              tabIndex={-1}
              aria-label={`${e.label} 홈으로 이동`}
              title={`${e.label} 홈`}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md transition hover:bg-(--color-surface-hi)"
            >
              <e.Logo className="h-6 w-6" />
            </a>
            <input
              type="text"
              name="q"
              placeholder={e.placeholder}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-xs text-(--color-fg) outline-none placeholder:text-(--color-fg-4)"
            />
            <button
              type="submit"
              tabIndex={-1}
              className="shrink-0 text-(--color-fg-4) hover:text-(--color-fg-2)"
              aria-label="검색"
            >
              <CornerDownLeft className="h-3 w-3" />
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
