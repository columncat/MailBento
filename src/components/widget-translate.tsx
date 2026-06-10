"use client";

import { useState } from "react";

import { CornerDownLeft } from "lucide-react";

/** 입력 내용을 Google 번역(EN→KR) 새 탭으로 보낸다. */
function openTranslate(text: string) {
  const t = text.trim();
  if (!t) return;
  window.open(
    `https://translate.google.com/?sl=en&tl=ko&op=translate&text=${encodeURIComponent(t)}`,
    "_blank",
    "noopener",
  );
}

export function WidgetTranslate() {
  const [text, setText] = useState("");

  return (
    <div className="flex h-full flex-col gap-2.5 p-5">
      <div className="flex h-6 shrink-0 items-center justify-between">
        <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-(--color-fg-2)">
          Translate
        </span>
        <span className="font-mono text-[10px] text-(--color-fg-4)">
          EN → KR
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          openTranslate(text);
        }}
        className="flex min-h-0 flex-1 flex-col gap-2.5"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter = 번역, Shift+Enter = 줄바꿈.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              openTranslate(text);
            }
          }}
          placeholder="영어 문장 입력… (Enter 번역 · Shift+Enter 줄바꿈)"
          autoComplete="off"
          className="min-h-0 flex-1 resize-none overflow-y-auto rounded-lg bg-(--color-bg-2) p-3 text-xs leading-relaxed text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none transition placeholder:text-(--color-fg-4) focus:ring-(--color-accent)"
        />
        <button
          type="submit"
          className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-(--color-bg-2) font-mono text-[11px] tracking-wider text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg)"
        >
          <CornerDownLeft className="h-3 w-3" />
          TRANSLATE
        </button>
      </form>
    </div>
  );
}
