"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { MailMessageDetail } from "@/lib/providers/types";

import { ProviderIcon } from "./provider-icon";

interface Props {
  accountId: number;
  accountDisplayName: string;
  messageId: string | null;
  onClose: () => void;
}

export function MessageModal({
  accountId,
  accountDisplayName,
  messageId,
  onClose,
}: Props) {
  const [detail, setDetail] = useState<MailMessageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!messageId) {
      setDetail(null);
      setError(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setDetail(null);

    fetch(`/api/mail/${accountId}/${encodeURIComponent(messageId)}`, {
      signal: ac.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        return json;
      })
      .then((json: { message: MailMessageDetail }) => {
        setDetail(json.message);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "알 수 없는 오류");
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [accountId, messageId]);

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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
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
            <Dialog.Close className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-(--color-fg-3) hover:bg-(--color-surface-hi) hover:text-(--color-fg)">
              <X className="h-4 w-4" />
            </Dialog.Close>
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
