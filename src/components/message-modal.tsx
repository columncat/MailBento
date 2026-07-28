"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, Archive, ArchiveX, Loader2, MailOpen, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { MessageMark } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import type { MailMessageDetail } from "@/lib/providers/types";

import { MarkPicker } from "./message-mark";
import { ProviderIcon } from "./provider-icon";

interface Props {
  accountId: number;
  accountDisplayName: string;
  messageId: string | null;
  onClose: () => void;
  /** 읽음/표식이 바뀌면 목록을 다시 읽도록 알린다. */
  onFlagsChanged?: () => void;
  /**
   * 보관본을 열 때의 행 id.
   *
   * 주면 IMAP 을 타지 않고 사본을 그대로 읽는다. 라이브 경로는 계정이 없으면
   * 404 를 내고 열람과 동시에 읽음 표시를 남기는데, 원본이 사라진 사본에는
   * 둘 다 맞지 않는다.
   */
  archiveId?: number | null;
  /** 라이브 메일일 때 보관 토글. 보관돼 있으면 그 행 id 가 들어온다. */
  archivedId?: number | null;
  onToggleArchive?: () => void;
}

interface Flag {
  read: boolean;
  mark: MessageMark | null;
}

export function MessageModal({
  accountId,
  accountDisplayName,
  messageId,
  onClose,
  onFlagsChanged,
  archiveId,
  archivedId,
  onToggleArchive,
}: Props) {
  const [detail, setDetail] = useState<MailMessageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flag, setFlagState] = useState<Flag>({ read: false, mark: null });

  /** 표식 갱신 — 낙관적으로 반영하고 서버에 기록. */
  const patchFlag = useCallback(
    async (patch: Partial<Flag>) => {
      if (!messageId) return;
      setFlagState((prev) => ({ ...prev, ...patch }));
      try {
        // 보관본의 표식은 사본 자신에 남긴다 — 원본 계정이 이미 없을 수 있다
        const url = archiveId
          ? `/api/archive/${archiveId}`
          : `/api/mail/${accountId}/${encodeURIComponent(messageId)}`;
        await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        onFlagsChanged?.();
      } catch {
        /* 네트워크 오류 — 다음 새로고침에서 반영 */
      }
    },
    [accountId, messageId, archiveId, onFlagsChanged],
  );

  useEffect(() => {
    if (!messageId) {
      setDetail(null);
      setError(null);
      setFlagState({ read: false, mark: null });
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setDetail(null);

    // 보관본은 사본을 그대로 읽는다 — IMAP 도, 읽음 표시도 타지 않는다
    const url = archiveId
      ? `/api/archive/${archiveId}`
      : `/api/mail/${accountId}/${encodeURIComponent(messageId)}`;
    fetch(url, { signal: ac.signal, cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        return json;
      })
      .then((json: { message: MailMessageDetail; flag?: Flag }) => {
        setDetail(json.message);
        // 서버가 열람 시점에 읽음 처리하고 현재 표식을 함께 준다
        setFlagState(json.flag ?? { read: true, mark: null });
        onFlagsChanged?.();
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "알 수 없는 오류");
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
    // onFlagsChanged 는 상위에서 useCallback 으로 고정 — 넣어도 재실행되지 않음
  }, [accountId, messageId, archiveId, onFlagsChanged]);

  const open = !!messageId;
  const dateStr = detail
    ? new Date(detail.receivedAt).toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        {/* pointerdown 전파 차단 — React 포털 이벤트가 컴포넌트 트리로 버블되어
            뒤쪽 dnd-kit 정렬 센서를 활성화(드래그 시 박스 순서 변경)하던 버그 방지.
            Radix 자체 핸들러(overlay 클릭 닫기)는 같은 요소라 그대로 동작. */}
        <Dialog.Overlay
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0"
        />
        <Dialog.Content
          aria-describedby={undefined}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-[min(960px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card)] bg-(--color-surface) ring-1 ring-(--color-border) shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {/* 헤더 */}
          <div className="flex items-start justify-between gap-4 border-b border-(--color-border-soft) px-6 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-(--color-bg-2) ring-1 ring-(--color-border)">
                <ProviderIcon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <Dialog.Title asChild>
                  <h2
                    className="line-clamp-2 text-[18px] leading-tight"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {detail?.subject ?? (loading ? "불러오는 중…" : " ")}
                  </h2>
                </Dialog.Title>
                <div className="mt-1 truncate text-[11px] text-(--color-fg-4)">
                  {accountDisplayName}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* 보관 — 사본을 떠 둔다. 원본이 서버에서 사라져도 남는다.
                  보관본을 보고 있을 때는 이미 사본이라 띄우지 않는다. */}
              {!archiveId && onToggleArchive && (
                <button
                  type="button"
                  onClick={onToggleArchive}
                  aria-pressed={!!archivedId}
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-md ring-1 transition",
                    archivedId
                      ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-(--color-accent)/40"
                      : "bg-(--color-bg-2) text-(--color-fg-3) ring-(--color-border-soft) hover:text-(--color-fg)",
                  )}
                  aria-label={archivedId ? "보관 해제" : "보관함에 담기"}
                  title={archivedId ? "보관 해제" : "보관함에 담기"}
                >
                  {archivedId ? (
                    <ArchiveX className="h-4 w-4" />
                  ) : (
                    <Archive className="h-4 w-4" />
                  )}
                </button>
              )}
              {/* 표식 — 서버 \Flagged 가 아니라 MailBento 안에서만 쓰는 마크 */}
              <MarkPicker
                current={flag.mark}
                onPick={(mark) => void patchFlag({ mark })}
                triggerClassName="h-8 w-8 ring-1 ring-(--color-border-soft) bg-(--color-bg-2)"
              />
              <button
                type="button"
                onClick={() => void patchFlag({ read: !flag.read })}
                title={
                  flag.read
                    ? "안읽음으로 되돌리기"
                    : "읽음으로 표시"
                }
                className="flex items-center gap-1.5 rounded-md bg-(--color-bg-2) px-2.5 py-1.5 text-[11px] text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
              >
                <MailOpen className="h-3.5 w-3.5" />
                {flag.read ? "안읽음으로" : "읽음으로"}
              </button>
              <Dialog.Close className="grid h-8 w-8 place-items-center rounded-md text-(--color-fg-3) hover:bg-(--color-surface-hi) hover:text-(--color-fg)">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
          </div>

          {/* 메타데이터 */}
          {detail && (
            <div className="border-b border-(--color-border-soft) px-6 py-3 text-xs">
              <MetaRow
                label="From"
                value={
                  detail.from.name
                    ? `${detail.from.name} <${detail.from.email}>`
                    : detail.from.email
                }
              />
              {detail.to.length > 0 && (
                <MetaRow
                  label="To"
                  value={detail.to
                    .map((a) => (a.name ? `${a.name} <${a.email}>` : a.email))
                    .join(", ")}
                />
              )}
              {detail.cc.length > 0 && (
                <MetaRow
                  label="Cc"
                  value={detail.cc
                    .map((a) => (a.name ? `${a.name} <${a.email}>` : a.email))
                    .join(", ")}
                />
              )}
              <MetaRow label="Date" value={dateStr} mono />
            </div>
          )}

          {/* 본문 */}
          <div className="scrollbar-thin flex-1 overflow-y-auto">
            {loading ? (
              <LoadingBody />
            ) : error ? (
              <ErrorBody message={error} />
            ) : detail?.html ? (
              <div
                className="email-body bg-white p-6 text-[14px] leading-relaxed text-black"
                style={{ wordBreak: "break-word" }}
                dangerouslySetInnerHTML={{ __html: detail.html }}
              />
            ) : detail?.text ? (
              <pre
                className="m-0 whitespace-pre-wrap p-6 font-mono text-[13px] leading-relaxed text-(--color-fg-2)"
                style={{ wordBreak: "break-word" }}
              >
                {detail.text}
              </pre>
            ) : (
              <div className="px-6 py-12 text-center text-xs text-(--color-fg-4)">
                본문이 없습니다
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-1">
      <span className="w-12 shrink-0 text-(--color-fg-4)">{label}</span>
      <span
        className={`min-w-0 flex-1 break-words text-(--color-fg-2) ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function LoadingBody() {
  return (
    <div className="flex flex-col gap-3 p-6">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-(--color-bg-2)"
          style={{ width: `${[100, 95, 88, 92, 60, 85, 70, 50][i]}%` }}
        />
      ))}
    </div>
  );
}

function ErrorBody({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-(--color-danger)">
      <AlertCircle className="h-6 w-6" />
      <span className="text-sm font-medium">본문을 불러오지 못했습니다</span>
      <span className="line-clamp-3 max-w-md text-[11.5px] text-(--color-fg-4)">
        {message}
      </span>
    </div>
  );
}
