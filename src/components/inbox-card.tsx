"use client";

import {
  AlertCircle,
  Archive,
  ArchiveX,
  ExternalLink,
  Inbox,
  Loader2,
} from "lucide-react";
import { useState } from "react";

import type { MessageMark, Provider } from "@/lib/db/schema";
import type { MailMessage } from "@/lib/providers/types";
import { useSwipe } from "@/lib/use-swipe";
import { cn, formatRelativeTime } from "@/lib/utils";

import { MarkPicker } from "./message-mark";
import { MessageModal } from "./message-modal";
import { ProviderIcon } from "./provider-icon";

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

export function InboxCard({
  data,
  onFlagsChanged,
  headerDragProps,
}: {
  data: InboxCardData;
  /** 읽음/표식이 바뀌면 대시보드가 목록을 다시 읽도록 알린다. */
  onFlagsChanged?: () => void;
  /**
   * 카드 순서 손잡이 props. 머리말에 붙는다 —
   * 카드 전체에 두면 본문 글자를 고를 수도, 목록을 터치로 굴릴 수도 없다.
   */
  headerDragProps?: React.HTMLAttributes<HTMLElement>;
}) {
  const { account, messages, unreadCount, error, loading } = data;
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);
  const [busyArchive, setBusyArchive] = useState<string | null>(null);

  /**
   * 보관 토글.
   *
   * 본문은 서버가 알아서 구한다 — 목록 행에는 본문이 없고, 클라이언트가 보낸
   * HTML 을 그대로 저장하면 sanitize 를 우회하는 길이 열린다.
   */
  const toggleArchive = async (m: MailMessage) => {
    if (busyArchive) return;
    setBusyArchive(m.id);
    try {
      if (m.archiveId) {
        await fetch(`/api/archive/${m.archiveId}`, { method: "DELETE" });
      } else {
        await fetch("/api/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: account.id, messageId: m.id }),
        });
      }
      onFlagsChanged?.();
    } catch {
      /* 네트워크 오류 — 다음 새로고침에서 반영 */
    } finally {
      setBusyArchive(null);
    }
  };
  const hasMessages = messages.length > 0;

  const patchFlag = async (
    messageId: string,
    patch: { read?: boolean; mark?: MessageMark | null },
  ) => {
    try {
      await fetch(
        `/api/mail/${account.id}/${encodeURIComponent(messageId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      onFlagsChanged?.();
    } catch {
      /* 네트워크 오류 — 다음 새로고침에서 반영 */
    }
  };

  // override 값이 있으면 우선 사용
  const shownEmail = account.displayEmail ?? account.email;
  const webUrl = account.webUrl ?? "";

  return (
    <>
      <article className="group relative flex h-[460px] flex-col rounded-[var(--radius-card)] bg-(--color-surface) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)">
        {/* 카드 헤더 — 여기를 잡아 카드 순서를 바꾼다 */}
        <header
          {...(headerDragProps ?? {})}
          title={headerDragProps ? "머리말을 끌어 메일함 순서 변경" : undefined}
          className={cn(
            "flex items-center justify-between border-b border-(--color-border-soft) px-5 py-4",
            headerDragProps && "cursor-grab touch-none active:cursor-grabbing",
          )}>
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-(--color-bg-2) ring-1 ring-(--color-border)">
              <ProviderIcon overrideUrl={account.iconUrl} size={32} />
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

          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-2"
          >
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
              <MailRow
                key={m.id}
                message={m}
                onOpen={() => setOpenMessageId(m.id)}
                onArchiveToggle={() => void toggleArchive(m)}
                onPickMark={(mark) => void patchFlag(m.id, { mark })}
              />
            ))}
          </ul>
        )}
      </article>

      <MessageModal
        accountId={account.id}
        accountDisplayName={account.displayName}
        messageId={openMessageId}
        onClose={() => setOpenMessageId(null)}
        onFlagsChanged={onFlagsChanged}
        archivedId={
          messages.find((m) => m.id === openMessageId)?.archiveId ?? null
        }
        onToggleArchive={() => {
          const m = messages.find((x) => x.id === openMessageId);
          if (m) void toggleArchive(m);
        }}
      />
    </>
  );
}

/**
 * 메일 한 줄.
 *
 * 좌우 어느 쪽으로든 밀면 보관에 담고, 이미 담긴 것은 뺀다. 아이콘을 두지
 * 않은 이유는 줄이 이미 빽빽해서다 — 보낸이·제목·시각·표식이 한 줄을 나눠 쓴다.
 */
function MailRow({
  message: m,
  onOpen,
  onArchiveToggle,
  onPickMark,
}: {
  message: MailMessage;
  onOpen: () => void;
  onArchiveToggle: () => void;
  onPickMark: (mark: MessageMark | null) => void;
}) {
  const swipe = useSwipe(onArchiveToggle);
  const archived = !!m.archiveId;

  return (
    <li className="relative overflow-hidden">
      {/* 미는 동안 뒤에서 드러나는 안내 */}
      {swipe.active && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-between px-5 text-[12px] transition-colors",
            swipe.armed
              ? "bg-(--color-accent-soft) text-(--color-accent-strong)"
              : "bg-(--color-bg-2) text-(--color-fg-4)",
          )}
        >
          <span className="flex items-center gap-1.5">
            {archived ? <ArchiveX className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {archived ? "보관 해제" : "보관"}
          </span>
          <span className="flex items-center gap-1.5">
            {archived ? "보관 해제" : "보관"}
            {archived ? <ArchiveX className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </span>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        {...swipe.handlers}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        style={{
          transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined,
          // 미는 중에는 붙어 오게, 놓으면 제자리로 미끄러지게
          transition: swipe.active ? undefined : "transform 160ms",
        }}
        className={cn(
          "group/row relative flex w-full cursor-pointer touch-pan-y items-start gap-3 bg-(--color-surface) px-5 py-3 text-left transition-colors hover:bg-(--color-surface-hi)",
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
                      m.unread ? "text-(--color-fg-2)" : "text-(--color-fg-3)",
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

                {/* 보관된 것은 표식 왼쪽에 조용히 알려 준다 — 아이콘 버튼은
                    없앴고, 담고 빼는 일은 좌우로 밀어서 한다 */}
                {archived && (
                  <Archive
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--color-accent-strong)"
                    aria-label="보관됨"
                  />
                )}

                {/* 표식 — 달려 있으면 항상 보이고, 없으면 hover 때만 */}
                <MarkPicker
                  current={m.mark}
                  onPick={onPickMark}
                  className={cn(
                    "mt-0.5 transition",
                    m.mark
                      ? "opacity-100"
                      : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
                  )}
                />
      </div>
    </li>
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
