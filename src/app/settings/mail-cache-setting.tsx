"use client";

import { useState } from "react";

interface Props {
  initial: {
    mailCacheSeconds: number;
    refreshIntervalSeconds: number;
    forceOnInterval: boolean;
  };
}

export function MailFetchSettings({ initial }: Props) {
  const [ttl, setTtl] = useState(String(initial.mailCacheSeconds));
  const [interval, setIntervalV] = useState(
    String(initial.refreshIntervalSeconds),
  );
  const [force, setForce] = useState(initial.forceOnInterval);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    const t = Number(ttl);
    const iv = Number(interval);
    if (!Number.isFinite(t) || t < 0 || !Number.isFinite(iv) || iv < 15) {
      setMsg({ ok: false, text: "캐시 0 이상 · 주기 15초 이상" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailCacheSeconds: Math.round(t),
          refreshIntervalSeconds: Math.round(iv),
          forceOnInterval: force,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();
      setTtl(String(saved.mailCacheSeconds));
      setIntervalV(String(saved.refreshIntervalSeconds));
      setForce(Boolean(saved.forceOnInterval));
      setMsg({ ok: true, text: "저장됨 — 대시보드 새로고침 시 적용" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "저장 실패" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <div className="mb-1 text-base font-medium text-(--color-fg)">
        메일 가져오기
      </div>
      <p className="mb-4 text-xs text-(--color-fg-4)">
        캐시 TTL 안에는 서버가 IMAP 재조회 없이 캐시를 반환합니다 (0 = 캐시 끔).
        수동 새로고침 버튼은 항상 즉시 다시 가져옵니다.
      </p>

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-3">
          <span className="w-44 shrink-0 text-sm text-(--color-fg-2)">
            서버 캐시 TTL
          </span>
          <input
            type="number"
            min={0}
            max={3600}
            value={ttl}
            onChange={(e) => setTtl(e.target.value)}
            className={numCls}
          />
          <span className="text-sm text-(--color-fg-3)">초</span>
        </label>

        <label className="flex items-center gap-3">
          <span className="w-44 shrink-0 text-sm text-(--color-fg-2)">
            자동 새로고침 주기
          </span>
          <input
            type="number"
            min={15}
            max={3600}
            value={interval}
            onChange={(e) => setIntervalV(e.target.value)}
            className={numCls}
          />
          <span className="text-sm text-(--color-fg-3)">초</span>
        </label>

        <label className="flex items-start gap-3">
          <span className="w-44 shrink-0 pt-0.5 text-sm text-(--color-fg-2)">
            주기마다 강제 fetch
          </span>
          <span className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                className="h-4 w-4 accent-(--color-accent)"
              />
              <span className="text-sm text-(--color-fg-2)">
                {force ? "켜짐" : "꺼짐"}
              </span>
            </span>
            <span className="text-[11px] leading-relaxed text-(--color-fg-4)">
              켜짐: interval 도달 시 캐시를 무시하고 항상 IMAP 재조회. (새 세션
              첫 로드는 여전히 TTL 이내면 캐시 사용) · 꺼짐: interval 도 캐시
              적용 → 실제 IMAP 조회는 TTL 주기.
            </span>
          </span>
        </label>

        <div className="flex items-center gap-3">
          <span className="w-44 shrink-0" />
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-full bg-(--color-accent) px-4 py-2 text-sm font-medium text-(--color-bg) hover:bg-(--color-accent-strong) disabled:opacity-50"
          >
            저장
          </button>
          {msg && (
            <span
              className={
                "text-xs " +
                (msg.ok
                  ? "text-(--color-accent-strong)"
                  : "text-(--color-danger)")
              }
            >
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

const numCls =
  "w-28 rounded-lg bg-(--color-bg-2) px-3 py-2 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)/60";
