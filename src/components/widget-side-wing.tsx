"use client";

import type { ArchivedSummary } from "@/lib/archive-server";
import type { Memo, Pin } from "@/lib/widget-storage";

import { WidgetArchive } from "./widget-archive";
import { WidgetCorkboard } from "./widget-corkboard";
import { WidgetMemo } from "./widget-memo";

interface Props {
  pins: Pin[];
  memos: Memo[];
  archived: ArchivedSummary[];
  onPinsChange: (pins: Pin[]) => void;
  onMemosChange: (memos: Memo[]) => void;
  onArchivedChange: (items: ArchivedSummary[]) => void;
  onOpenArchived: (item: ArchivedSummary) => void;
}

/**
 * 위젯 날개.
 *
 * 왼쪽 한 열을 보관함이 위아래로 다 쓴다 — 목록이 본체라 세로가 길수록 쓸모가
 * 있다. 오른쪽 열은 메모 위, 코크보드 아래로 쌓이고 둘 다 메일함 카드와 같은
 * 460px 이다.
 */
export function WidgetSideWing({
  pins,
  memos,
  archived,
  onPinsChange,
  onMemosChange,
  onArchivedChange,
  onOpenArchived,
}: Props) {
  return (
    <div className="grid min-h-0 grid-cols-2 grid-rows-[460px_460px] gap-4">
      <div className="row-span-2 min-h-0">
        <WidgetArchive
          items={archived}
          onOpen={onOpenArchived}
          onChange={onArchivedChange}
        />
      </div>
      <WidgetMemo memos={memos} onChange={onMemosChange} />
      <WidgetCorkboard pins={pins} onChange={onPinsChange} />
    </div>
  );
}
