import { Mail } from "lucide-react";

import type { Provider } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const IMAGE_ICONS: Partial<Record<Provider, { src: string; label: string }>> = {
  gmail: {
    src: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/gmail.svg",
    label: "Gmail",
  },
  outlook: {
    src: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/microsoft-outlook.svg",
    label: "Outlook",
  },
  outlook_imap: {
    src: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/microsoft-outlook.svg",
    label: "Outlook (IMAP)",
  },
  naver: {
    src: "https://mail.naver.com/favicon.ico",
    label: "Naver Mail",
  },
};

export function ProviderIcon({
  provider,
  overrideUrl,
  className,
  size = 20,
}: {
  provider: Provider;
  /** 사용자 정의 아이콘 URL. 지정 시 provider 기본값 대신 사용. */
  overrideUrl?: string | null;
  className?: string;
  size?: number;
}) {
  // 1) 사용자 정의 override
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

  // 2) provider 기본
  const image = IMAGE_ICONS[provider];
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image.src}
        alt={image.label}
        width={size}
        height={size}
        className={cn("rounded-sm", className)}
      />
    );
  }

  // 3) fallback — generic mail icon
  return (
    <Mail
      className={cn("text-(--color-fg-3)", className)}
      width={size}
      height={size}
    />
  );
}
