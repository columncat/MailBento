"use client";

import * as Popover from "@radix-ui/react-popover";
import {
  AlertCircle,
  Check,
  Circle,
  Star,
  Tag,
  Triangle,
  X,
} from "lucide-react";
import type { CSSProperties, ComponentType } from "react";

import { MESSAGE_MARKS, type MessageMark } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

interface MarkMeta {
  label: string;
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
  /** 표식 색 — 테마와 무관하게 서로 구분되도록 고정값. */
  color: string;
  /** 채워서 그릴지 (별/동그라미처럼 면이 있는 표식). */
  filled: boolean;
}

export const MARK_META: Record<MessageMark, MarkMeta> = {
  star: { label: "별표", Icon: Star, color: "oklch(0.82 0.16 85)", filled: true },
  circle: {
    label: "동그라미",
    Icon: Circle,
    color: "oklch(0.75 0.15 145)",
    filled: false,
  },
  triangle: {
    label: "세모",
    Icon: Triangle,
    color: "oklch(0.78 0.16 55)",
    filled: false,
  },
  cross: { label: "가위표", Icon: X, color: "oklch(0.68 0.20 25)", filled: false },
  exclaim: {
    label: "느낌표",
    Icon: AlertCircle,
    color: "oklch(0.70 0.20 15)",
    filled: false,
  },
  check: {
    label: "체크",
    Icon: Check,
    color: "oklch(0.75 0.14 235)",
    filled: false,
  },
};

export function MarkIcon({
  mark,
  className,
}: {
  mark: MessageMark;
  className?: string;
}) {
  const meta = MARK_META[mark];
  const { Icon } = meta;
  return (
    <Icon
      className={cn("shrink-0", className)}
      style={{
        color: meta.color,
        ...(meta.filled ? { fill: meta.color } : {}),
      }}
    />
  );
}

/**
 * 표식 고르기 팝오버.
 * 같은 표식을 다시 누르면 해제된다.
 */
export function MarkPicker({
  current,
  onPick,
  className,
  triggerClassName,
}: {
  current: MessageMark | null | undefined;
  onPick: (mark: MessageMark | null) => void;
  className?: string;
  triggerClassName?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={current ? `표식: ${MARK_META[current].label}` : "표식 달기"}
          title={current ? MARK_META[current].label : "표식 달기"}
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-md transition hover:bg-(--color-surface-hi)",
            current ? "text-(--color-fg-2)" : "text-(--color-fg-4)",
            className,
            triggerClassName,
          )}
        >
          {current ? (
            <MarkIcon mark={current} className="h-3.5 w-3.5" />
          ) : (
            <Tag className="h-3.5 w-3.5" />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="end"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="z-50 rounded-xl bg-(--color-surface) p-1.5 shadow-xl ring-1 ring-(--color-border)"
        >
          <div className="flex items-center gap-0.5">
            {MESSAGE_MARKS.map((m) => (
              <Popover.Close asChild key={m}>
                <button
                  type="button"
                  onClick={() => onPick(current === m ? null : m)}
                  aria-label={MARK_META[m].label}
                  title={MARK_META[m].label}
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-md transition hover:bg-(--color-surface-hi)",
                    current === m && "bg-(--color-bg-2) ring-1 ring-(--color-accent)/50",
                  )}
                >
                  <MarkIcon mark={m} className="h-4 w-4" />
                </button>
              </Popover.Close>
            ))}
            {current && (
              <>
                <span className="mx-0.5 h-5 w-px bg-(--color-border-soft)" />
                <Popover.Close asChild>
                  <button
                    type="button"
                    onClick={() => onPick(null)}
                    className="rounded-md px-2 py-1 text-[11px] text-(--color-fg-3) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg)"
                  >
                    지우기
                  </button>
                </Popover.Close>
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
