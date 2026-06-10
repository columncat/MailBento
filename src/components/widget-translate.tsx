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
        className="relative min-h-0 flex-1"
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
          placeholder="여기에 입력..."
          autoComplete="off"
          className="h-full w-full resize-none overflow-y-auto rounded-lg bg-(--color-bg-2) p-3 pr-8 text-xs leading-relaxed text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none transition placeholder:text-(--color-fg-4) focus:ring-(--color-accent)"
        />
        <button
          type="submit"
          tabIndex={-1}
          aria-label="번역"
          className="absolute right-2.5 bottom-2.5 text-(--color-fg-4) hover:text-(--color-fg-2)"
        >
          <CornerDownLeft className="h-3 w-3" />
        </button>
      </form>
    </div>
  );
}
