"use client";

import { useState } from "react";

export function MailCacheSetting({ initial }: { initial: number }) {
  const [val, setVal] = useState(String(initial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) {
      setMsg({ ok: false, text: "0 이상 숫자" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailCacheSeconds: Math.round(n) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();
      setVal(String(saved.mailCacheSeconds));
      setMsg({ ok: true, text: "저장됨" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "저장 실패" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <div className="mb-1 text-base font-medium text-(--color-fg)">
        메일 캐시
      </div>
      <p className="mb-3 text-xs text-(--color-fg-4)">
        불러온 지 이 시간(초) 안에는 서버가 IMAP 재조회 없이 캐시를 돌려줍니다. 0 =
        끔. 수동 새로고침 버튼은 항상 즉시 다시 가져옵니다.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={3600}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-28 rounded-lg bg-(--color-bg-2) px-3 py-2 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)/60"
        />
        <span className="text-sm text-(--color-fg-3)">초</span>
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
              (msg.ok ? "text-(--color-accent-strong)" : "text-(--color-danger)")
            }
          >
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}
