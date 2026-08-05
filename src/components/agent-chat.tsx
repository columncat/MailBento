"use client";

import { Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * 에이전트와의 채팅창.
 *
 * 브라우저는 BentoAgent 를 직접 부르지 않는다. 이 앱의 `/api/agent/chat` 이
 * 대신 불러 준다 — 토큰이 화면에 실리지 않고, 이미 있는 로그인이 그대로
 * 경계가 된다.
 *
 * 대화 내용은 여기 두지 않는다. 맥락은 에이전트 쪽 세션 하나에 있고 Discord 와
 * 같은 것을 쓴다. 이 목록은 이번에 열어 둔 창에서 주고받은 것만 보여 준다 —
 * 새로고침하면 비지만 대화 자체는 이어진다.
 */

interface Turn {
  role: "me" | "agent";
  text: string;
  denials?: string[];
  error?: boolean;
}

export function AgentChat() {
  // 설정되지 않은 배포에서는 버튼 자체를 두지 않는다. 눌러야 알 수 있는
  // 것보다, 없는 편이 낫다.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    fetch("/api/agent/chat")
      .then((r) => r.json())
      .then((j: { configured?: boolean }) => setEnabled(j.configured === true))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  const send = async () => {
    const message = draft.trim();
    if (!message || busy) return;
    setDraft("");
    setTurns((t) => [...t, { role: "me", text: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const json = (await res.json()) as {
        reply?: string;
        error?: string;
        denials?: string[];
        isError?: boolean;
      };
      setTurns((t) => [
        ...t,
        {
          role: "agent",
          text: json.reply ?? json.error ?? "[빈 응답]",
          denials: json.denials,
          error: !res.ok || json.isError === true,
        },
      ]);
    } catch (e) {
      setTurns((t) => [
        ...t,
        { role: "agent", text: e instanceof Error ? e.message : String(e), error: true },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    await fetch("/api/agent/chat", { method: "DELETE" }).catch(() => undefined);
    setTurns([{ role: "agent", text: "새 대화로 시작합니다. Discord 쪽 맥락도 함께 지워졌습니다." }]);
  };

  if (enabled !== true) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full bg-(--color-surface) px-4 py-2 text-sm text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)"
        aria-label="에이전트와 대화"
        title="에이전트와 대화 — 메일함과 메모함 권한이 있습니다"
      >
        <Sparkles className="h-4 w-4" />
        대화
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4 sm:p-6">
          {/* 뒤를 덮되 화면은 계속 보이게 — 메모를 보며 물어보는 일이 많다 */}
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-(--color-bg)/40"
          />
          <section className="relative flex h-[min(640px,80vh)] w-[min(440px,92vw)] flex-col overflow-hidden rounded-[var(--radius-card)] bg-(--color-surface) shadow-2xl ring-1 ring-(--color-border-soft)">
            <header className="flex shrink-0 items-center justify-between border-b border-(--color-border-soft) px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-(--color-accent-strong)" />
                <span className="truncate text-sm font-medium text-(--color-fg)">
                  에이전트
                </span>
                <span className="shrink-0 text-[11px] break-keep text-(--color-fg-4)">
                  메일함과 메모함 권한이 있습니다
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void reset()}
                  className="grid h-7 w-7 place-items-center rounded-lg text-(--color-fg-4) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
                  aria-label="새 대화"
                  title="새 대화 — 맥락을 지웁니다 (Discord 쪽도 함께)"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-7 w-7 place-items-center rounded-lg text-(--color-fg-4) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
                  aria-label="닫기"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="scrollbar-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
              {turns.length === 0 && (
                <p className="px-1 py-8 text-center text-[13px] break-keep text-(--color-fg-4)">
                  메모함과 메일함을 읽고 고칠 수 있습니다.
                  <br />
                  &ldquo;오늘 안 읽은 메일 정리해줘&rdquo; 처럼 말해 보세요.
                </p>
              )}
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap",
                    t.role === "me"
                      ? "ml-auto bg-(--color-accent-soft) text-(--color-accent-strong)"
                      : t.error
                        ? "bg-(--color-danger)/15 text-(--color-danger)"
                        : "bg-(--color-bg-2) text-(--color-fg-2)",
                  )}
                >
                  {t.text}
                  {t.denials && t.denials.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-(--color-warn)">
                      허용되지 않은 도구를 쓰려고 했습니다: {t.denials.join(", ")}
                    </p>
                  )}
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-[12px] text-(--color-fg-4)">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  생각하는 중… (도구를 쓰면 몇십 초 걸립니다)
                </div>
              )}
              <div ref={endRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="flex shrink-0 gap-2 border-t border-(--color-border-soft) px-3 py-3"
            >
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder="무엇을 할까요? (Enter 로 전송)"
                className="scrollbar-thin min-w-0 flex-1 resize-none rounded-lg bg-(--color-bg-2) px-3 py-2 text-[13px] text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="grid w-11 shrink-0 place-items-center rounded-lg bg-(--color-accent) text-(--color-bg) transition hover:bg-(--color-accent-strong) disabled:opacity-40"
                aria-label="보내기"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
