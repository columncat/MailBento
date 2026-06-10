"use client";

import { REGIONS } from "@/lib/widget-config";

import { WidgetClock } from "./widget-clock";
import { WidgetSearch } from "./widget-search";
import { WidgetTranslate } from "./widget-translate";

export function WidgetHeader() {
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

      <div className="grid divide-y divide-(--color-border-soft) lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.5fr)] lg:divide-x lg:divide-y-0">
        {/* KR · US 시계 묶음 */}
        <div className="grid grid-cols-2 divide-x divide-(--color-border-soft)">
          {REGIONS.map((r) => (
            <WidgetClock key={r.key} region={r} />
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
