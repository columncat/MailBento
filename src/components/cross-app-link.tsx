"use client";

import { ArrowUpRight, NotebookPen } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * 자매 앱(MemoBento)으로 건너가는 버튼.
 *
 * URL 은 서버가 `MEMOBENTO_URL` 로 지정하면 그 값을 쓰고,
 * 없으면 **지금 보고 있는 호스트의 다른 포트**로 유추한다.
 * (LAN IP / Tailscale IP / MagicDNS 어느 쪽으로 접속했든 그대로 따라가도록)
 */
export function MemoBentoLink({
  href,
  defaultPort = 3001,
}: {
  href?: string | null;
  defaultPort?: number;
}) {
  const [url, setUrl] = useState(href ?? "");

  useEffect(() => {
    if (href) {
      setUrl(href);
      return;
    }
    setUrl(
      `${window.location.protocol}//${window.location.hostname}:${defaultPort}`,
    );
  }, [href, defaultPort]);

  return (
    <a
      href={url || "#"}
      className="group flex items-center gap-2 rounded-full bg-(--color-surface) px-4 py-2 text-sm text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)"
      title={url ? `MemoBento 로 이동 (${url})` : "MemoBento 로 이동"}
    >
      <NotebookPen className="h-4 w-4" />
      <span className="hidden sm:inline">MemoBento</span>
      <ArrowUpRight className="h-3 w-3 text-(--color-fg-4) transition group-hover:text-(--color-fg-2)" />
    </a>
  );
}
