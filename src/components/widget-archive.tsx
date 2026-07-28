"use client";

import { Archive, ArchiveX, GripVertical, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ArchivedSummary } from "@/lib/archive-server";
import { cn } from "@/lib/utils";

import { MarkIcon } from "./message-mark";

/** 되돌릴 수 있는 시간. 이 안에는 서버로 삭제 요청을 보내지 않는다. */
const UNDO_MS = 6000;

const DND_TYPE = "application/x-mailbento-archive";

function formatWhen(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
}

/**
 * 메일 보관함.
 *
 * 메일함 카드가 IMAP 이 주는 최신 N통을 보여주는 창이라면, 여기는 사용자가
 * 손으로 골라 떠 둔 사본이다. 원본이 서버에서 지워지거나 뒤로 밀려나도 그대로
 * 남는다. 순서도 손으로 잡는다.
 */
export function WidgetArchive({
  items,
  onOpen,
  onChange,
}: {
  items: ArchivedSummary[];
  onOpen: (item: ArchivedSummary) => void;
  /** 서버가 돌려준 새 목록으로 갈아끼운다. */
  onChange: (items: ArchivedSummary[]) => void;
}) {
  // 지운 직후 6초는 화면에서만 감춘다 — 사본을 지우고 나면 되돌릴 방법이
  // 없으므로(원본이 이미 사라졌을 수 있다) 요청 자체를 미룬다.
  const [pendingId, setPendingId] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ id: number; side: "before" | "after" } | null>(
    null,
  );

  const flush = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/archive/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (res.ok) onChangeRef.current(json.list ?? []);
    } catch {
      /* 다음 새로고침에서 복구 */
    }
  }, []);

  // onChange 는 부모가 매 렌더 새로 만들 수 있어 타이머 의존성으로 두면
  // 타이머가 계속 다시 걸린다. 최신 값만 ref 로 들고 있는다.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const remove = (id: number) => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      // 앞서 지우던 것이 있으면 그건 확정한다
      if (pendingId != null && pendingId !== id) void flush(pendingId);
    }
    setPendingId(id);
    timer.current = window.setTimeout(() => {
      setPendingId(null);
      timer.current = null;
      void flush(id);
    }, UNDO_MS);
  };

  const undo = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setPendingId(null);
  };

  // 창을 떠나면 미뤄 둔 삭제를 확정한다 — 애매하게 남겨 두면 다음에 열었을 때
  // 지운 줄 알았던 것이 되살아나 보인다.
  useEffect(
    () => () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        if (pendingId != null) void flush(pendingId);
      }
    },
    [pendingId, flush],
  );

  const reorder = async (targetId: number, side: "before" | "after") => {
    if (dragId == null || dragId === targetId) return;
    const ids = items.map((i) => i.id).filter((id) => id !== dragId);
    const at = ids.indexOf(targetId);
    if (at < 0) return;
    ids.splice(side === "after" ? at + 1 : at, 0, dragId);

    // 낙관적 반영 — 놓는 즉시 자리가 잡히게
    const byId = new Map(items.map((i) => [i.id, i]));
    onChange(ids.map((id) => byId.get(id)!).filter(Boolean));
    try {
      const res = await fetch("/api/archive/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: ids }),
      });
      const json = await res.json();
      if (res.ok) onChange(json.list ?? []);
    } catch {
      /* 다음 새로고침에서 복구 */
    }
  };

  const shown = items.filter((i) => i.id !== pendingId);

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[var(--radius-card)] bg-(--color-surface) p-5 ring-1 ring-(--color-border-soft)">
      <header className="mb-3 flex shrink-0 items-center justify-between">
        <h2
          className="text-xl leading-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          메일 보관함
        </h2>
        <span className="font-mono text-[11px] text-(--color-fg-4)">
          {String(items.length).padStart(2, "0")} SAVED
        </span>
      </header>

      {pendingId != null && (
        <div className="mb-2 flex shrink-0 items-center gap-2 rounded-lg bg-(--color-bg-2) px-3 py-2 text-[12px] text-(--color-fg-2) ring-1 ring-(--color-border-soft)">
          <span className="min-w-0 flex-1 truncate">보관 해제했습니다</span>
          <button
            type="button"
            onClick={undo}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-(--color-accent-strong) transition hover:bg-(--color-surface-hi)"
          >
            <Undo2 className="h-3 w-3" aria-hidden />
            되돌리기
          </button>
        </div>
      )}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="rounded-lg border border-dashed border-(--color-border) py-6 text-center text-sm break-keep text-(--color-fg-4)">
            <Archive className="mx-auto mb-1.5 h-4 w-4" />
            메일함에서 보관 버튼을 눌러 담아 두세요
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((item) => (
              <li
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(item)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(item);
                  }
                }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DND_TYPE)) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setOver({
                    id: item.id,
                    // 위쪽 절반이면 앞, 아래쪽이면 뒤. 뒤가 없으면 맨 끝으로
                    // 내릴 방법이 사라진다.
                    side: e.clientY < r.top + r.height / 2 ? "before" : "after",
                  });
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  if (!e.dataTransfer.types.includes(DND_TYPE)) return;
                  e.preventDefault();
                  const side = over?.id === item.id ? over.side : "before";
                  setOver(null);
                  void reorder(item.id, side);
                }}
                className={cn(
                  "group flex cursor-pointer items-start gap-2 rounded-lg bg-(--color-bg-2) p-2.5 ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)",
                  over?.id === item.id &&
                    over.side === "before" &&
                    "border-t-2 border-(--color-accent) pt-2",
                  over?.id === item.id &&
                    over.side === "after" &&
                    "border-b-2 border-(--color-accent) pb-2",
                  dragId === item.id && "opacity-50",
                )}
              >
                <span
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData(DND_TYPE, String(item.id));
                    setDragId(item.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  role="button"
                  aria-label="끌어서 순서 변경"
                  title="끌어서 순서 변경"
                  className="mt-0.5 grid w-3 shrink-0 cursor-grab place-items-center rounded text-(--color-fg-4) opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {item.mark && <MarkIcon mark={item.mark} className="h-3 w-3" />}
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[13px]",
                        item.read ? "text-(--color-fg-2)" : "font-medium text-(--color-fg)",
                      )}
                    >
                      {item.subject || "(제목 없음)"}
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-(--color-fg-4)">
                      {formatWhen(item.receivedAt)}
                    </span>
                  </div>
                  <div className="truncate text-[11.5px] text-(--color-fg-4)">
                    {item.fromName || item.fromEmail}
                    <span className="mx-1">·</span>
                    {item.sourceLabel}
                    {item.sourceAccountId == null && (
                      <span
                        className="ml-1 text-(--color-warn)"
                        title="원본 메일함이 삭제되었습니다. 사본은 그대로 남아 있습니다"
                      >
                        (원본 없음)
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(item.id);
                  }}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-(--color-fg-4) opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-(--color-danger)/20 hover:text-(--color-danger)"
                  aria-label="보관 해제"
                  title="보관 해제"
                >
                  <ArchiveX className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
