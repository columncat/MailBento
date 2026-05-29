"use client";

import { StickyNote, Trash2 } from "lucide-react";
import { useState } from "react";

import { uid, type Memo } from "@/lib/widget-storage";

interface Props {
  memos: Memo[];
  onChange: (memos: Memo[]) => void;
}

export function WidgetMemo({ memos, onChange }: Props) {
  const [input, setInput] = useState("");

  const addMemo = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    const newMemo: Memo = {
      id: uid(),
      text,
      createdAt: Date.now(),
    };
    onChange([newMemo, ...memos]);
    setInput("");
  };

  const removeMemo = (id: string) => {
    onChange(memos.filter((m) => m.id !== id));
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[var(--radius-card)] bg-(--color-surface) p-5 ring-1 ring-(--color-border-soft)">
      <header className="mb-3 flex shrink-0 items-center justify-between">
        <h2
          className="text-lg leading-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Memo
        </h2>
        <span className="font-mono text-[10px] text-(--color-fg-4)">
          {String(memos.length).padStart(2, "0")} NOTES
        </span>
      </header>

      <form onSubmit={addMemo} className="mb-3 flex shrink-0 gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="메모 입력 후 Enter"
          maxLength={300}
          className="flex-1 rounded-lg bg-(--color-bg-2) px-3 py-2 text-xs text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60"
        />
        <button
          type="submit"
          className="rounded-lg bg-(--color-accent) px-3 py-2 text-xs font-medium text-(--color-bg) hover:bg-(--color-accent-strong)"
        >
          + 추가
        </button>
      </form>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      {memos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-(--color-border) py-6 text-center text-xs text-(--color-fg-4)">
          <StickyNote className="mx-auto mb-1.5 h-3.5 w-3.5" />
          메모가 없습니다
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {memos.map((memo) => (
            <li
              key={memo.id}
              className="group flex items-start gap-2 rounded-lg bg-(--color-bg-2) p-2.5 ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words text-xs leading-relaxed text-(--color-fg-2) whitespace-pre-wrap">
                  {memo.text}
                </p>
                <p className="mt-1 font-mono text-[9.5px] text-(--color-fg-4)">
                  {new Date(memo.createdAt).toLocaleString("ko-KR", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeMemo(memo.id)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-(--color-fg-4) opacity-0 transition group-hover:opacity-100 hover:bg-(--color-danger)/20 hover:text-(--color-danger)"
                aria-label="메모 삭제"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </section>
  );
}
