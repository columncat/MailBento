"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";

import { apiPath } from "@/lib/api-path";
import { readJson } from "@/lib/read-json";

/**
 * 에이전트 답변 안에 박히는 장부 항목 — `[[ledger:<id>]]`.
 *
 * MailBento 와 MemoBento 가 **같은 파일**을 쓴다. 두 앱 다 장부를 모르므로
 * 에이전트 다리에게 물어본다 (`/api/agent/ledger`). 메일 쪽 메모 조각과 같은
 * 길이다 — 장부 비밀번호를 이 앱에 들이지 않는다.
 *
 * 금액 글자는 LedgerBento 가 만든 것을 그대로 쓴다. 통화마다 소수 자리가
 * 다르고 그 규칙은 저쪽에 있다.
 *
 * 누를 것이 없다. 장부를 고치는 것은 에이전트에게 말로 시키거나 장부 화면에서 한다.
 */

export interface LedgerCard {
  id: string;
  date: string;
  flow: "income" | "expense";
  title: string;
  amountText: string;
  accountName: string | null;
  categoryName: string | null;
  note: string | null;
}

/** 한 번 받아 온 것은 들고 있는다 — 조각들이 서로를 모르므로 모듈에 둔다. */
const cache = new Map<string, LedgerCard | null>();
const inflight = new Map<string, Promise<LedgerCard | null>>();

async function fetchEntry(id: string): Promise<LedgerCard | null> {
  if (cache.has(id)) return cache.get(id) ?? null;
  const running = inflight.get(id);
  if (running) return running;

  const p = (async () => {
    try {
      const res = await fetch(apiPath(`/api/agent/ledger?ids=${encodeURIComponent(id)}`), {
        cache: "no-store",
      });
      const json = await readJson<{ entries?: LedgerCard[] }>(res);
      const found = json.entries?.find((e) => e.id === id) ?? null;
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

const chip = (text: string) => (
  <span className="rounded bg-(--color-bg) px-1.5 py-0.5 text-[12px] text-(--color-fg-4)">
    {text}
  </span>
);

/**
 * `missing` — 못 찾았을 때 보일 말.
 *
 * 메모 조각이 메모함에서 못 찾은 id 를 여기로 넘긴다. 에이전트가 장부 항목을
 * `[[memo:…]]` 로 적은 지난 대화가 남아 있어서다. 그때는 "없는 메모" 라고 해야
 * 맞다 — 메모를 찾으라고 한 것이니까.
 */
export function LedgerRef({
  entryId,
  block,
  missing = "지워졌거나 없는 장부 항목",
}: {
  entryId: string;
  block: boolean;
  missing?: string;
}) {
  const [entry, setEntry] = useState<LedgerCard | null | undefined>(() =>
    cache.has(entryId) ? cache.get(entryId) : undefined,
  );

  useEffect(() => {
    if (entry !== undefined) return;
    let alive = true;
    void fetchEntry(entryId).then((e) => {
      if (alive) setEntry(e);
    });
    return () => {
      alive = false;
    };
  }, [entryId, entry]);

  if (entry === undefined) return chip("불러오는 중…");
  if (entry === null) return chip(missing);

  const sign = entry.flow === "expense" ? "−" : "+";
  const tone = entry.flow === "expense" ? "text-(--color-fg)" : "text-(--color-accent)";

  if (!block) {
    return (
      <span className="inline-flex max-w-full items-baseline gap-1 rounded bg-(--color-bg) px-1.5 py-0.5 text-[12px] text-(--color-fg-2) ring-1 ring-(--color-border-soft)">
        <span className="truncate">{entry.title}</span>
        <span className={`shrink-0 tabular-nums ${tone}`}>
          {sign}
          {entry.amountText}
        </span>
      </span>
    );
  }

  const foot = [entry.date, entry.categoryName, entry.accountName].filter(Boolean).join(" · ");
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-(--color-bg) px-3 py-2 ring-1 ring-(--color-border-soft)">
      <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-(--color-fg-4)" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-[13px] leading-relaxed">
          <span className="min-w-0 flex-1 break-words text-(--color-fg-2)">{entry.title}</span>
          <span className={`shrink-0 font-medium tabular-nums ${tone}`}>
            {sign}
            {entry.amountText}
          </span>
        </p>
        {entry.note && (
          <p className="text-[12px] break-words whitespace-pre-wrap text-(--color-fg-3)">
            {entry.note}
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-(--color-fg-4)">{foot}</p>
      </div>
    </div>
  );
}
