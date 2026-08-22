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
 * 체크도 여기서 누른다. 두 채팅창이 다를 이유가 없어서다 — 메모 쪽에서 되는
 * 것이 메일 쪽에서 안 되면, 같은 대화인데 창구에 따라 할 수 있는 일이 달라진다.
 * 누르면 그것도 다리를 지나 메모에 반영된다.
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

/** 체크를 켜고 끈다. 다리가 여는 것은 읽기와 이것 둘뿐이다. */
async function toggleMemo(id: string, done: boolean): Promise<boolean> {
  try {
    const res = await fetch(apiPath("/api/agent/memos"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, done }),
    });
    await readJson(res);
    return true;
  } catch {
    return false;
  }
}

async function fetchMemo(id: string): Promise<MemoCard | null> {
  if (cache.has(id)) return cache.get(id) ?? null;
  const running = inflight.get(id);
  if (running) return running;

  const p = (async () => {
    try {
      const res = await fetch(apiPath(`/api/agent/memos?ids=${encodeURIComponent(id)}`), {
        cache: "no-store",
      });
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

  const checkable = memo.checkable;
  const done = checkable && memo.done;

  /*
   * 눌리는 순간 화면부터 바꾼다.
   *
   * 다리를 지나 메모까지 갔다 오는 데 한 박자가 걸린다. 그동안 상자가 그대로면
   * 눌리지 않은 것처럼 보여 한 번 더 누르게 된다. 실패하면 되돌리고 캐시도
   * 비워, 다음에 그릴 때 서버 값을 다시 받게 한다.
   */
  const toggle = async () => {
    const next = !memo.done;
    setMemo({ ...memo, done: next });
    cache.set(memo.id, { ...memo, done: next });
    const ok = await toggleMemo(memo.id, next);
    if (!ok) {
      setMemo({ ...memo, done: memo.done });
      cache.delete(memo.id);
    }
  };

  if (!block) {
    return (
      <span className="inline-flex max-w-full items-baseline gap-1 rounded bg-(--color-bg) px-1.5 py-0.5 text-[12px] text-(--color-fg-2) ring-1 ring-(--color-border-soft)">
        {checkable && (
          <Check
            className={`h-3 w-3 shrink-0 self-center ${
              done ? "text-(--color-accent)" : "opacity-25"
            }`}
            strokeWidth={3}
          />
        )}
        <span className={`truncate ${done ? "line-through opacity-60" : ""}`}>
          {memo.label}
        </span>
      </span>
    );
  }

  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-(--color-bg) px-3 py-2 ring-1 ring-(--color-border-soft)">
      {checkable ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          onClick={() => void toggle()}
          className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition ${
            done
              ? "border-(--color-accent) bg-(--color-accent) text-(--color-bg)"
              : "border-(--color-border) hover:border-(--color-accent)"
          }`}
          aria-label={done ? "완료 취소" : "완료"}
        >
          {done && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>
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
