"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, Moon, Palette, Settings2, Sun } from "lucide-react";

import {
  COLUMNS,
  MODES,
  THEMES,
  type ColumnsPref,
  type ModePref,
  type ThemeKey,
} from "@/lib/preferences";
import { cn } from "@/lib/utils";

interface Props {
  theme: ThemeKey;
  mode: ModePref;
  columns: ColumnsPref;
  onThemeChange: (t: ThemeKey) => void;
  onModeChange: (m: ModePref) => void;
  onColumnsChange: (c: ColumnsPref) => void;
}

export function PreferencesPopover({
  theme,
  mode,
  columns,
  onThemeChange,
  onModeChange,
  onColumnsChange,
}: Props) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className="grid h-9 w-9 place-items-center rounded-full bg-(--color-surface) text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2) hover:text-(--color-fg-2) outline-none"
        aria-label="표시 설정"
        title="표시 설정"
      >
        <Settings2 className="h-4 w-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[300px] rounded-2xl bg-(--color-surface-2) p-4 shadow-2xl ring-1 ring-(--color-border) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {/* 모드 */}
          <div className="mb-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-(--color-fg-4)">
              모드
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onModeChange(m)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition",
                    mode === m
                      ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-1 ring-(--color-accent)/40"
                      : "bg-(--color-bg-2) text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)",
                  )}
                >
                  {m === "dark" ? (
                    <Moon className="h-3.5 w-3.5" />
                  ) : (
                    <Sun className="h-3.5 w-3.5" />
                  )}
                  {m === "dark" ? "다크" : "라이트"}
                </button>
              ))}
            </div>
          </div>

          {/* 테마 */}
          <div className="mb-4">
            <div className="mb-2.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-(--color-fg-4)">
              <Palette className="h-3 w-3" />
              테마
            </div>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onThemeChange(t.key)}
                  className={cn(
                    "group relative flex flex-col items-center gap-1.5 rounded-lg p-2 transition",
                    theme === t.key
                      ? "bg-(--color-bg-2) ring-1 ring-(--color-accent)/60"
                      : "hover:bg-(--color-surface-hi)",
                  )}
                >
                  <div
                    aria-hidden
                    className="h-7 w-7 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                    style={{ background: t.swatch }}
                  />
                  <span className="text-[10.5px] text-(--color-fg-2)">
                    {t.label}
                  </span>
                  {theme === t.key && (
                    <Check className="absolute top-1.5 right-1.5 h-2.5 w-2.5 text-(--color-accent-strong)" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* 열 개수 */}
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-(--color-fg-4)">
              열 개수
            </div>
            <div className="flex gap-1.5">
              {COLUMNS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onColumnsChange(c)}
                  className={cn(
                    "flex-1 rounded-md py-1.5 text-xs font-medium transition",
                    columns === c
                      ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-1 ring-(--color-accent)/40"
                      : "bg-(--color-bg-2) text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)",
                  )}
                >
                  {c === "auto" ? "Auto" : c}
                </button>
              ))}
            </div>
          </div>

          <Popover.Arrow className="fill-(--color-surface-2)" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
