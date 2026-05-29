"use client";

import type { Memo, Pin } from "@/lib/widget-storage";

import { WidgetCorkboard } from "./widget-corkboard";
import { WidgetMemo } from "./widget-memo";

interface Props {
  pins: Pin[];
  memos: Memo[];
  onPinsChange: (pins: Pin[]) => void;
  onMemosChange: (memos: Memo[]) => void;
}

export function WidgetSideWing({
  pins,
  memos,
  onPinsChange,
  onMemosChange,
}: Props) {
  return (
    <div className="grid h-full min-h-0 grid-cols-2 gap-4">
      <WidgetCorkboard pins={pins} onChange={onPinsChange} />
      <WidgetMemo memos={memos} onChange={onMemosChange} />
    </div>
  );
}
