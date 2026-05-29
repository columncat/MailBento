"use client";

import { Pencil, Plus } from "lucide-react";

import type { WidgetFolder } from "@/lib/widget-storage";
import { autoIconUrl } from "@/lib/widget-storage";
import { cn } from "@/lib/utils";

interface Props {
  folder: WidgetFolder;
  onEdit: () => void;
  /** 한 변 길이(px). 지정되면 정사각형 고정, 없으면 폭에 맞춰 aspect-square. */
  size?: number;
}

export function WidgetFolderCard({ folder, onEdit, size }: Props) {
  // 2×2 슬롯 — 부족하면 빈 슬롯
  const slots = [0, 1, 2, 3].map((i) => folder.links[i] ?? null);

  return (
    <article
      className={cn(
        "group relative flex shrink-0 flex-col rounded-[var(--radius-card)] bg-(--color-surface) p-3.5 ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)",
        size ? "" : "aspect-square w-full",
      )}
      style={size ? { width: size, height: size } : undefined}
    >
      {/* 편집 버튼 — 우상단 떠있음 */}
      <button
        type="button"
        onClick={onEdit}
        className="absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md bg-(--color-surface-2)/80 text-(--color-fg-4) opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
        aria-label="폴더 편집"
        title="폴더 편집"
      >
        <Pencil className="h-3 w-3" />
      </button>

      {/* 링크 2×2 — 여유 공간 모두 사용 */}
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1.5">
        {slots.map((link, i) =>
          link ? (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-0 flex-col items-center justify-center gap-1.5 rounded-lg p-1 transition hover:bg-(--color-surface-hi)"
              title={`${link.title || link.url}\n${link.url}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={link.iconUrl || autoIconUrl(link.url)}
                alt=""
                className="h-12 w-12 shrink-0 rounded-xl object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <span className="line-clamp-2 w-full break-words text-center text-[11px] leading-tight text-(--color-fg-2)">
                {link.title || "(이름 없음)"}
              </span>
            </a>
          ) : (
            <button
              key={`empty-${i}`}
              type="button"
              onClick={onEdit}
              className={cn(
                "flex min-h-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-(--color-border-soft) p-1 text-(--color-fg-4) opacity-40 transition",
                "hover:opacity-100 hover:border-(--color-border) hover:text-(--color-fg-3)",
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="text-[9px]">빈 슬롯</span>
            </button>
          ),
        )}
      </div>

      {/* 폴더명 — 아이콘/링크 배치 후 가운데 아래쪽 (간섭 없음) */}
      <div className="mt-2.5 shrink-0 border-t border-(--color-border-soft)/60 pt-2 text-center">
        <h3 className="truncate text-[12.5px] font-medium text-(--color-fg)">
          {folder.name || "(이름 없음)"}
        </h3>
      </div>
    </article>
  );
}
