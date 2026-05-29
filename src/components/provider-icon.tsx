import { Mail } from "lucide-react";

import { cn } from "@/lib/utils";

export function ProviderIcon({
  overrideUrl,
  className,
  size = 20,
}: {
  /** 사용자 정의 아이콘 URL. 지정 시 기본 메일 아이콘 대신 사용. */
  overrideUrl?: string | null;
  className?: string;
  size?: number;
}) {
  if (overrideUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={overrideUrl}
        alt=""
        width={size}
        height={size}
        className={cn("rounded-sm object-contain", className)}
      />
    );
  }

  // 기본 — 일반 메일 아이콘
  return (
    <Mail
      className={cn("text-(--color-fg-3)", className)}
      width={size}
      height={size}
    />
  );
}
