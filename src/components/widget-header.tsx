"use client";

import { toRegion, type RegionInput } from "@/lib/regions";

import { WidgetClock } from "./widget-clock";
import { WidgetSearch } from "./widget-search";
import { WidgetTranslate } from "./widget-translate";

export function WidgetHeader({ regions }: { regions: RegionInput[] }) {
  // 파생 필드(좌표 표기·타임존 라벨·날씨 키)는 그릴 때 만든다 —
  // 저장해 두면 위경도를 바꿨을 때 표기만 옛 값으로 남는다.
  const shown = regions.map((r) => toRegion(r));
  return (
    <section className="relative isolate overflow-hidden rounded-[var(--radius-card)] bg-(--color-surface) ring-1 ring-(--color-border-soft)">
      {/* 상단 강조선 */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--color-accent) 20%, var(--color-accent) 80%, transparent)",
          opacity: 0.6,
        }}
      />

      <div className="grid divide-y divide-(--color-border-soft) lg:min-h-[240px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.5fr)] lg:divide-x lg:divide-y-0">
        {/* KR · US 시계 묶음 */}
        <div
          className="grid divide-x divide-(--color-border-soft)"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, shown.length)}, minmax(0, 1fr))`,
          }}
        >
          {shown.map((r) => (
            <WidgetClock key={r.id} region={r} />
          ))}
        </div>
        <div className="border-t border-(--color-border-soft) lg:border-t-0 lg:border-l">
          <WidgetSearch />
        </div>
        <div className="border-t border-(--color-border-soft) lg:border-t-0 lg:border-l">
          <WidgetTranslate />
        </div>
      </div>
    </section>
  );
}
