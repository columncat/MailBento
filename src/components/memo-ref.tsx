"use client";

import { useEffect, useState } from "react";
import { Check, StickyNote } from "lucide-react";

import { apiPath } from "@/lib/api-path";
import { readJson } from "@/lib/read-json";

/**
 * 에이전트 답변 안에 박히는 메모 조각 — 메일 쪽 판.
 *
 * MemoBento 의 같은 이름 파일과 그리는 모양은 같지만, 재료를 얻는 길이 다르다.
 * 저쪽은 화면이 이미 메모함 목록을 들고 있어 거기서 꺼내 쓴다. 이 앱은 메모를
 * 아예 모르므로 **에이전트에게 물어본다** — 이미 그 다리를 거쳐 대화하고 있으니
 * 새 자격 증명을 이 앱에 들이지 않아도 된다.
 *
 * 여기서는 누를 수 없다. 체크를 바꾸려면 메모 쪽으로 가야 한다 — 그래서 빈
 * 상자를 그리지 않는다. 누르지도 못하는 상자는 "여기서 할 수 있다" 는 거짓말이다.
 * 끝난 것만 표시한다.
 */

export interface MemoCard {
  id: string;
  label: string;
  notebook: string;
  checkable: boolean;
  done: boolean;
  dueAt: number | null;
}

/**
 * 한 번 받아 온 것은 들고 있는다.
 *
 * 같은 메모를 여러 번 가리킬 수 있고, 대화 창을 여닫을 때마다 다시 그린다.
 * 모듈에 두는 이유는 조각들이 서로를 모르기 때문이다 — 부모에 상태를 두려면
 * 채팅창이 메모를 알아야 하는데, 그 창은 두 앱이 같은 파일을 쓴다.
 */
const cache = new Map<string, MemoCard | null>();
const inflight = new Map<string, Promise<MemoCard | null>>();

async function fetchMemo(id: string): Promise<MemoCard | null> {
  if (cache.has(id)) return cache.get(id) ?? null;
  const running = inflight.get(id);
  if (running) return running;

  const p = (async () => {
    try {
      const res = await fetch(
        apiPath(`/api/agent/chat?memos=${encodeURIComponent(id)}`),
        { cache: "no-store" },
      );
      const json = await readJson<{ memos?: MemoCard[] }>(res);
      const found = json.memos?.find((m) => m.id === id) ?? null;
      cache.set(id, found);
      return found;
    } catch {
      // 못 받은 것은 캐시에 넣지 않는다. 잠깐 끊긴 것뿐일 수 있다.
      return null;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

/** 기한을 짧게. MemoBento 의 formatDue 와 같은 규칙. */
function formatDue(dueAt: number): string {
  const d = new Date(dueAt);
  const t = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(t)) / 86400000);
  const noon = d.getHours() * 60 + d.getMinutes() === 12 * 60;
  const time = noon
    ? ""
    : ` ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (diff === 0) return `오늘${time}`;
  if (diff === 1) return `내일${time}`;
  if (diff === -1) return `어제${time}`;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  if (d.getFullYear() !== t.getFullYear()) return `${d.getFullYear()}.${mm}.${dd}${time}`;
  return `${mm}.${dd}${time}`;
}

export function MemoRef({ memoId, block }: { memoId: string; block: boolean }) {
  const [memo, setMemo] = useState<MemoCard | null | undefined>(() =>
    cache.has(memoId) ? cache.get(memoId) : undefined,
  );

  useEffect(() => {
    if (memo !== undefined) return;
    let alive = true;
    void fetchMemo(memoId).then((m) => {
      if (alive) setMemo(m);
    });
    return () => {
      alive = false;
    };
  }, [memoId, memo]);

  const chip = (text: string, muted = true) => (
    <span
      className={`rounded bg-(--color-bg) px-1.5 py-0.5 text-[12px] ${
        muted ? "text-(--color-fg-4)" : "text-(--color-fg-2)"
      }`}
    >
      {text}
    </span>
  );

  if (memo === undefined) return chip("메모 불러오는 중…");
  if (memo === null) return chip("지워졌거나 없는 메모");

  const done = memo.checkable && memo.done;

  if (!block) {
    return (
      <span className="inline-flex max-w-full items-baseline gap-1 rounded bg-(--color-bg) px-1.5 py-0.5 text-[12px] text-(--color-fg-2) ring-1 ring-(--color-border-soft)">
        {done && (
          <Check className="h-3 w-3 shrink-0 self-center text-(--color-accent)" strokeWidth={3} />
        )}
        <span className={`truncate ${done ? "line-through opacity-60" : ""}`}>
          {memo.label}
        </span>
      </span>
    );
  }

  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-(--color-bg) px-3 py-2 ring-1 ring-(--color-border-soft)">
      {done ? (
        <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border border-(--color-accent) bg-(--color-accent) text-(--color-bg)">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : (
        <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-(--color-fg-4)" />
      )}

      <div className="min-w-0 flex-1">
        <p
          className={`text-[13px] leading-relaxed break-words whitespace-pre-wrap ${
            done ? "text-(--color-fg-4) line-through" : "text-(--color-fg-2)"
          }`}
        >
          {memo.label}
        </p>
        <p className="mt-0.5 text-[11px] text-(--color-fg-4)">
          {memo.notebook}
          {memo.dueAt != null && ` · ${formatDue(memo.dueAt)}`}
        </p>
      </div>
    </div>
  );
}
