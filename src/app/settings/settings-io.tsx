"use client";

import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";

interface WidgetExport {
  app: "mailbento";
  type: "widget-settings";
  version: number;
  exportedAt: string;
  widget: unknown;
}

type Status = { kind: "idle" | "ok" | "err"; msg?: string };

export function SettingsIO() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/widget", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const widget = await res.json();
      const payload: WidgetExport = {
        app: "mailbento",
        type: "widget-settings",
        version: 1,
        exportedAt: new Date().toISOString(),
        widget,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ymd = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `mailbento-widget-${ymd}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus({ kind: "ok", msg: "내보내기 완료" });
    } catch (e) {
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "내보내기 실패",
      });
    } finally {
      setBusy(false);
    }
  };

  const onImportFile = async (file: File) => {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // 래핑 포맷({app,widget}) 또는 raw WidgetState 모두 허용
      const widget =
        parsed && typeof parsed === "object" && "widget" in parsed
          ? (parsed as WidgetExport).widget
          : parsed;
      if (
        !widget ||
        typeof widget !== "object" ||
        !Array.isArray((widget as { folders?: unknown }).folders)
      ) {
        throw new Error("올바른 위젯 설정 파일이 아닙니다");
      }
      const res = await fetch("/api/widget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(widget),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus({
        kind: "ok",
        msg: "불러오기 완료 — 대시보드에 반영됩니다",
      });
    } catch (e) {
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "불러오기 실패",
      });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <header className="mb-1 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-medium text-(--color-fg)">
            위젯 설정 백업
          </div>
          <div className="text-xs text-(--color-fg-4)">
            폴더 · 코크보드 · 메모를 JSON 파일로 내보내고 불러옵니다 (다른 기기/서버
            이전용)
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onExport}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            내보내기
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-full bg-(--color-accent-soft) px-3 py-1.5 text-xs text-(--color-accent-strong) ring-1 ring-(--color-accent)/40 transition hover:bg-(--color-accent)/25 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            불러오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
        </div>
      </header>

      {status.kind !== "idle" && (
        <p
          className={
            "mt-2 text-xs " +
            (status.kind === "ok"
              ? "text-(--color-accent-strong)"
              : "text-(--color-danger)")
          }
        >
          {status.msg}
        </p>
      )}
    </section>
  );
}
