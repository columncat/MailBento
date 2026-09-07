"use client";

import { HardDrive, Trash2 } from "lucide-react";
import { useState } from "react";

import { apiFetch } from "@/lib/api-path";

/** 사람이 읽을 크기. 소수 한 자리면 "3.4MB" 처럼 눈에 바로 들어온다. */
function mb(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export interface BodyCacheInfo {
  count: number;
  bytes: number;
  /** 그중 수집기가 미리 받아 둔(아직 아무도 안 연) 통수. */
  prefetched: number;
  fileBytes: number;
}

/**
 * 메일 본문 캐시를 비우는 자리.
 *
 * 이 표를 만지는 코드는 캐시 모듈과 그것을 부르는 두 라우트뿐이라, 뭔가
 * 이상해 보여도 사람이 손댈 길이 없었다 — "계정을 통째로 지우거나 30일
 * 기다리기". 계정을 지우면 보관함의 출처 표시까지 끊긴다.
 *
 * 비운 뒤 파일이 실제로 줄었는지도 함께 보여 준다. 행만 지우면 SQLite 파일은
 * 줄지 않아서 "비웠는데 왜 그대로냐" 는 물음이 남기 때문이다.
 */
export function BodyCachePanel({ initial }: { initial: BodyCacheInfo }) {
  const [info, setInfo] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const clear = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch("/api/body-cache", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as {
        cleared: { count: number; bytes: number };
        file: { before: number; after: number };
        warning?: string;
      };
      setInfo({ count: 0, bytes: 0, prefetched: 0, fileBytes: j.file.after });
      setMsg({
        ok: !j.warning,
        text:
          `${j.cleared.count}통 (${mb(j.cleared.bytes)}) 비움 · ` +
          `DB 파일 ${mb(j.file.before)} → ${mb(j.file.after)}` +
          (j.warning ? ` — ${j.warning}` : ""),
      });
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : "비우지 못했습니다",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-medium text-(--color-fg)">
            메일 본문 캐시
          </div>
          <div className="text-xs text-(--color-fg-4)">
            메일 본문을 최대 100통까지 담아 두었다가 열 때 씁니다. 열어 본
            메일에 더해, 새로 온 메일은 자동 수집이 미리 받아 둡니다(최대
            30통 — 나머지 70통은 열어 본 메일 몫으로 남습니다). 비워도 메일은
            그대로이고, 다음에 열 때 다시 받아 옵니다.
          </div>
        </div>
        <button
          type="button"
          onClick={clear}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {busy ? "비우는 중…" : "비우기"}
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-(--color-fg-3)">
        <span>
          담긴 본문{" "}
          <b className="font-medium text-(--color-fg)">{info.count}통</b> ·{" "}
          {mb(info.bytes)}
        </span>
        {/*
          0 이면 아무 말도 하지 않는다. 미리 받은 것이 없는 상태(막 비웠거나,
          새 메일이 없었거나, MAIL_PREFETCH 로 꺼 두었거나)에 "미리 받음 0통"
          이 서 있으면 무엇이 잘못됐다는 신호처럼 읽힌다.
        */}
        {info.prefetched > 0 && (
          <span className="text-(--color-fg-4)">
            그중 미리 받아 둠 {info.prefetched}통
          </span>
        )}
        <span className="flex items-center gap-1.5 text-(--color-fg-4)">
          <HardDrive className="h-3 w-3" />
          DB 파일 {mb(info.fileBytes)}
        </span>
      </div>

      {msg && (
        <p
          className={
            "mt-2 text-xs " +
            (msg.ok ? "text-(--color-accent-strong)" : "text-(--color-danger)")
          }
        >
          {msg.text}
        </p>
      )}
    </section>
  );
}
