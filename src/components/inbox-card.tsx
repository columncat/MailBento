"use client";

import { AlertCircle, ExternalLink, Inbox, Loader2 } from "lucide-react";
import { useState } from "react";

import type { Provider } from "@/lib/db/schema";
import type { MailMessage } from "@/lib/providers/types";
import { cn, formatRelativeTime } from "@/lib/utils";

import { MessageModal } from "./message-modal";
import { ProviderIcon } from "./provider-icon";

/** Provider 별 기본 웹메일 URL — account.webUrl 이 비어있을 때 fallback. */
const DEFAULT_WEB_URL: Record<Provider, string> = {
  gmail: "https://mail.google.com/",
  outlook: "https://outlook.live.com/mail/",
  outlook_imap: "https://outlook.office.com/mail/",
  naver: "https://mail.naver.com/",
  imap: "",
};

export interface InboxCardData {
  account: {
    id: number;
    provider: Provider;
    displayName: string;
    email: string;
    iconUrl: string | null;
    displayEmail: string | null;
    webUrl: string | null;
  };
  loading: boolean;
  messages: MailMessage[];
  unreadCount: number | null;
  error: string | null;
}

export function InboxCard({ data }: { data: InboxCardData }) {
  const { account, messages, unreadCount, error, loading } = data;
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);
  const hasMessages = messages.length > 0;

  // override 값이 있으면 우선 사용
  const shownEmail = account.displayEmail ?? account.email;
  const webUrl = account.webUrl ?? DEFAULT_WEB_URL[account.provider] ?? "";

  return (
    <>
      <article className="group relative flex h-[460px] flex-col rounded-[var(--radius-card)] bg-(--color-surface) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)">
        {/* 카드 헤더 */}
        <header className="flex items-center justify-between border-b border-(--color-border-soft) px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-(--color-bg-2) ring-1 ring-(--color-border)">
              <ProviderIcon
                provider={account.provider}
                overrideUrl={account.iconUrl}
                size={32}
              />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-(--color-fg)">
                {account.displayName}
              </div>
              <div className="truncate text-xs text-(--color-fg-4)">
                {shownEmail}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {loading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-(--color-fg-4)" />
            )}
            {!loading &&
              unreadCount != null &&
              unreadCount > 0 && (
                <span className="rounded-full bg-(--color-accent-soft) px-2 py-0.5 font-mono text-[11px] text-(--color-accent-strong) ring-1 ring-(--color-accent)/30">
                  {unreadCount > 999 ? "999+" : unreadCount}
                </span>
              )}
            {webUrl && (
              <a
                href={webUrl}
                target="_blank"
                rel="noreferrer"
                className="grid h-7 w-7 place-items-center rounded-md text-(--color-fg-4) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
                aria-label="바로가기"
                title={webUrl}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </header>

        {/* 카드 본문 */}
        {loading && !hasMessages ? (
          <LoadingBody />
        ) : error ? (
          <ErrorBody message={error} />
        ) : !hasMessages ? (
          <EmptyBody />
        ) : (
          <ul className="scrollbar-thin flex flex-1 flex-col divide-y divide-(--color-border-soft) overflow-y-auto">
            {messages.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpenMessageId(m.id)}
                  className={cn(
                    "group/row flex w-full items-start gap-3 px-5 py-3 text-left transition hover:bg-(--color-surface-hi)",
                    m.unread && "bg-(--color-accent)/[0.04]",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-2 h-1.5 w-1.5 shrink-0 rounded-full",
                      m.unread ? "bg-(--color-accent)" : "bg-transparent",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-[13px]",
                          m.unread
                            ? "font-semibold text-(--color-fg)"
                            : "text-(--color-fg-2)",
                        )}
                      >
                        {m.from.name ?? m.from.email}
                      </span>
                      <span className="shrink-0 font-mono text-[10.5px] text-(--color-fg-4)">
                        {formatRelativeTime(m.receivedAt)}
                      </span>
                    </div>
                    <div
                      className={cn(
                        "truncate text-[13px]",
                        m.unread
                          ? "text-(--color-fg-2)"
                          : "text-(--color-fg-3)",
                      )}
                    >
                      {m.subject}
                    </div>
                    {m.snippet && (
                      <div className="mt-0.5 line-clamp-1 text-[11.5px] text-(--color-fg-4)">
                        {m.snippet}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>

      <MessageModal
        accountId={account.id}
        accountProvider={account.provider}
        accountDisplayName={account.displayName}
        messageId={openMessageId}
        onClose={() => setOpenMessageId(null)}
      />
    </>
  );
}

function LoadingBody() {
  return (
    <ul className="flex flex-1 flex-col divide-y divide-(--color-border-soft) overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="flex items-start gap-3 px-5 py-3"
          style={{ opacity: 1 - i * 0.12 }}
        >
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-(--color-border)" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="h-2.5 w-28 animate-pulse rounded bg-(--color-bg-2)" />
              <div className="h-2 w-10 animate-pulse rounded bg-(--color-bg-2)" />
            </div>
            <div className="h-2.5 w-3/4 animate-pulse rounded bg-(--color-bg-2)" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyBody() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-(--color-fg-4)">
      <Inbox className="h-6 w-6" />
      <span className="text-xs">받은 메일이 없습니다</span>
    </div>
  );
}

function ErrorBody({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-(--color-danger)">
      <AlertCircle className="h-6 w-6" />
      <span className="text-xs font-medium">가져오기 실패</span>
      <span className="line-clamp-3 text-[11px] text-(--color-fg-4)">
        {message}
      </span>
    </div>
  );
}
