"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  isValidTimeZone,
  MAX_REGIONS,
  toRegion,
  type RegionInput,
} from "@/lib/regions";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-path";

/** 자주 쓰는 표준시. 목록에 없으면 직접 적을 수 있다. */
const TZ_SUGGESTIONS = [
  "Asia/Seoul",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Indiana/Indianapolis",
  "Australia/Sydney",
  "UTC",
];

const input =
  "w-full rounded-lg bg-(--color-bg-2) px-2.5 py-1.5 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)";

const blank = (n: number): RegionInput => ({
  id: `r${n}-${Math.floor(Math.random() * 1e6)}`,
  label: "",
  badge: "",
  lat: 0,
  lng: 0,
  tz: "Asia/Seoul",
  unit: "C",
  locale: "ko-KR",
});

/**
 * 시계 위젯 지역 설정.
 *
 * 넣는 값은 이름·위경도·표준시·단위뿐이다. 좌표 표기와 타임존 라벨, 날씨 조회
 * 키는 저장하지 않고 그릴 때 파생한다 — 손으로 적게 두면 위경도를 바꿨을 때
 * 표기만 옛 값으로 남는다.
 */
export function RegionsSetting({ initial }: { initial: RegionInput[] }) {
  const [rows, setRows] = useState<RegionInput[]>(
    initial.length > 0 ? initial : [blank(1)],
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const patch = (i: number, p: Partial<RegionInput>) =>
    setRows((prev) => prev.map((r, n) => (n === i ? { ...r, ...p } : r)));

  const save = async () => {
    for (const r of rows) {
      if (!r.label.trim()) {
        setMsg({ ok: false, text: "이름을 비울 수 없습니다" });
        return;
      }
      if (!Number.isFinite(r.lat) || r.lat < -90 || r.lat > 90) {
        setMsg({ ok: false, text: `${r.label}: 위도는 -90 ~ 90` });
        return;
      }
      if (!Number.isFinite(r.lng) || r.lng < -180 || r.lng > 180) {
        setMsg({ ok: false, text: `${r.label}: 경도는 -180 ~ 180` });
        return;
      }
      if (!isValidTimeZone(r.tz)) {
        setMsg({ ok: false, text: `${r.label}: 알 수 없는 표준시 "${r.tz}"` });
        return;
      }
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regions: rows }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();
      setRows(saved.regions ?? rows);
      setMsg({ ok: true, text: "저장했습니다 — 대시보드를 새로고침하세요" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "저장 실패" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <datalist id="tz-list">
        {TZ_SUGGESTIONS.map((tz) => (
          <option key={tz} value={tz} />
        ))}
      </datalist>

      {rows.map((r, i) => {
        const preview = isValidTimeZone(r.tz) ? toRegion(r) : null;
        return (
          <div
            key={r.id}
            className="flex flex-col gap-2 rounded-xl bg-(--color-bg-2) p-3 ring-1 ring-(--color-border-soft)"
          >
            <div className="flex items-center gap-2">
              <input
                value={r.badge ?? ""}
                onChange={(e) => patch(i, { badge: e.target.value })}
                placeholder="KR"
                maxLength={4}
                aria-label={`${i + 1}번 지역 배지`}
                className={cn(input, "w-16 text-center font-mono uppercase")}
              />
              <input
                value={r.label}
                onChange={(e) => patch(i, { label: e.target.value })}
                placeholder="서울"
                aria-label={`${i + 1}번 지역 이름`}
                className={cn(input, "flex-1")}
              />
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((_, n) => n !== i))}
                disabled={rows.length <= 1}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-(--color-fg-4) transition hover:bg-(--color-danger)/20 hover:text-(--color-danger) disabled:opacity-30"
                aria-label={`${i + 1}번 지역 삭제`}
                title={rows.length <= 1 ? "최소 하나는 있어야 합니다" : "삭제"}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12px] text-(--color-fg-3)">
                위도
                <input
                  type="number"
                  step="0.0001"
                  value={String(r.lat)}
                  onChange={(e) => patch(i, { lat: Number(e.target.value) })}
                  aria-label={`${i + 1}번 지역 위도`}
                  className={cn(input, "w-28 tabular-nums")}
                />
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-(--color-fg-3)">
                경도
                <input
                  type="number"
                  step="0.0001"
                  value={String(r.lng)}
                  onChange={(e) => patch(i, { lng: Number(e.target.value) })}
                  aria-label={`${i + 1}번 지역 경도`}
                  className={cn(input, "w-28 tabular-nums")}
                />
              </label>
              <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-(--color-fg-3)">
                표준시
                <input
                  list="tz-list"
                  value={r.tz}
                  onChange={(e) => patch(i, { tz: e.target.value })}
                  aria-label={`${i + 1}번 지역 표준시`}
                  className={cn(input, "min-w-40 flex-1")}
                />
              </label>
              <select
                value={r.unit}
                onChange={(e) =>
                  patch(i, { unit: e.target.value === "F" ? "F" : "C" })
                }
                aria-label={`${i + 1}번 지역 온도 단위`}
                className={cn(input, "w-20")}
              >
                <option value="C">°C</option>
                <option value="F">°F</option>
              </select>
              <select
                value={r.locale}
                onChange={(e) =>
                  patch(i, {
                    locale: e.target.value === "en-US" ? "en-US" : "ko-KR",
                  })
                }
                aria-label={`${i + 1}번 지역 날짜 표기`}
                className={cn(input, "w-28")}
              >
                <option value="ko-KR">한국어</option>
                <option value="en-US">English</option>
              </select>
            </div>

            {/* 파생 값을 그대로 보여 준다 — 저장 전에 확인할 수 있게 */}
            <p className="font-mono text-[11px] text-(--color-fg-4)">
              {preview
                ? `${preview.badge} · ${preview.tzLabel} · ${preview.coords}`
                : "표준시를 확인하세요"}
            </p>
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, blank(prev.length + 1)])}
          disabled={rows.length >= MAX_REGIONS}
          className="flex items-center gap-1.5 rounded-lg bg-(--color-bg-2) px-3 py-2 text-sm text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) disabled:opacity-40"
          title={rows.length >= MAX_REGIONS ? `최대 ${MAX_REGIONS}개` : "지역 추가"}
        >
          <Plus className="h-4 w-4" />
          지역 추가
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong) disabled:opacity-50"
        >
          저장
        </button>
        {msg && (
          <span
            className={cn(
              "text-[12px]",
              msg.ok ? "text-(--color-accent-strong)" : "text-(--color-danger)",
            )}
          >
            {msg.text}
          </span>
        )}
      </div>

      <p className="text-[12px] break-keep text-(--color-fg-4)">
        날씨는 위경도로 조회합니다. 좌표 표기와 표준시 라벨은 자동으로 만들어지므로
        따로 적지 않습니다. 최대 {MAX_REGIONS}개까지 — 그보다 많으면 시계가 읽을 수
        없이 좁아집니다.
      </p>
    </div>
  );
}
