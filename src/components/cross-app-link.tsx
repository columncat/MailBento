"use client";

import { ArrowUpRight, BookMarked, Mail, StickyNote } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * 형제 앱 주소 유추.
 *
 * 접속 경로에 따라 정답이 다르다:
 *   - `mailbento.columncat.cc` 처럼 서브도메인으로 들어왔으면 → 형제 서브도메인.
 *     도메인에는 앱 포트가 열려 있지 않으므로 포트를 붙이면 깨진다.
 *   - LAN IP / Tailscale IP / MagicDNS 로 들어왔으면 → 같은 호스트의 다른 포트.
 *
 * 덕분에 들어온 경로를 그대로 따라간다. 서버가 `href`(환경변수 override)를 주면
 * 그 값이 항상 이긴다.
 *
 * **한 도메인을 경로로 나눠 쓰는 배포는 유추로 못 맞힌다.** `bento.example.com/memo`
 * 에서 `/paper` 로 가야 하는데, 여기서는 호스트만 보고 경로를 모른다. 그런
 * 배포에서는 환경변수로 전체 주소를 주어야 한다 — 그래서 `href` 가 늘 이긴다.
 */
export function siblingAppUrl(
  self: string,
  sibling: string,
  defaultPort: number,
): string {
  const { protocol, hostname } = window.location;
  const parts = hostname.split(".");
  if (parts.length >= 3 && parts[0].toLowerCase() === self) {
    return `${protocol}//${[sibling, ...parts.slice(1)].join(".")}`;
  }
  return `${protocol}//${hostname}:${defaultPort}`;
}

/** 이 앱이 무엇인지. 유추할 때 자기 서브도메인 이름으로도 쓴다. */
const SELF = "mailbento";

const APPS = {
  mailbento: { label: "MailBento", icon: Mail, port: 3000 },
  paperbento: { label: "PaperBento", icon: BookMarked, port: 3002 },
  memobento: { label: "MemoBento", icon: StickyNote, port: 3001 },
} as const;

/**
 * 형제 앱으로 건너가는 버튼.
 *
 * 앱마다 따로 만들지 않고 하나로 둔다. 앱이 셋이 되면서 같은 모양의 컴포넌트가
 * 앱마다 둘씩 생길 판이었다 — 넷째가 생기면 여섯이 된다.
 */
export function CrossAppLink({
  app,
  href,
}: {
  app: keyof typeof APPS;
  href?: string | null;
}) {
  const meta = APPS[app];
  const [url, setUrl] = useState(href ?? "");

  useEffect(() => {
    if (href) {
      setUrl(href);
      return;
    }
    setUrl(siblingAppUrl(SELF, app, meta.port));
  }, [href, app, meta.port]);

  const Icon = meta.icon;
  return (
    <a
      href={url || "#"}
      className="group flex items-center gap-2 rounded-full bg-(--color-surface) px-4 py-2 text-sm text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)"
      title={url ? `${meta.label} 로 이동 (${url})` : `${meta.label} 로 이동`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{meta.label}</span>
      <ArrowUpRight className="h-3 w-3 text-(--color-fg-4) transition group-hover:text-(--color-fg-2)" />
    </a>
  );
}

/** 예전 이름. 부르는 곳이 남아 있어 그대로 둔다. */
export function MemoBentoLink({ href }: { href?: string | null }) {
  return <CrossAppLink app="memobento" href={href} />;
}
