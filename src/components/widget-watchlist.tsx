"use client";

import { useEffect, useState } from "react";

import { STOCKS, proxied, type StockDef } from "@/lib/widget-config";
import { cn } from "@/lib/utils";

interface Quote extends StockDef {
  price: number | null;
  changePct: number | null;
  error?: boolean;
}

async function fetchKrStock(s: StockDef): Promise<Quote> {
  try {
    const r = await fetch(
      proxied(
        `https://polling.finance.naver.com/api/realtime/domestic/stock/${s.id}`,
      ),
      { cache: "no-store" },
    );
    const j = await r.json();
    const d = j.datas?.[0] ?? {};
    return {
      ...s,
      price: parseFloat(d.closePriceRaw),
      changePct: parseFloat(d.fluctuationsRatioRaw),
    };
  } catch {
    return { ...s, price: null, changePct: null, error: true };
  }
}

async function fetchKrIndex(s: StockDef): Promise<Quote> {
  try {
    const r = await fetch(
      proxied(
        `https://polling.finance.naver.com/api/realtime/domestic/index/${s.id}`,
      ),
      { cache: "no-store" },
    );
    const j = await r.json();
    const d = j.datas?.[0] ?? {};
    return {
      ...s,
      price: parseFloat(d.closePriceRaw),
      changePct: parseFloat(d.fluctuationsRatioRaw),
    };
  } catch {
    return { ...s, price: null, changePct: null, error: true };
  }
}

async function fetchFx(s: StockDef): Promise<Quote> {
  try {
    const r = await fetch(
      proxied(`https://api.stock.naver.com/marketindex/exchange/${s.id}`),
      { cache: "no-store" },
    );
    const j = await r.json();
    const e = j.exchangeInfo ?? {};
    return {
      ...s,
      price: parseFloat(e.calcPrice),
      changePct: parseFloat(e.fluctuationsRatio),
    };
  } catch {
    return { ...s, price: null, changePct: null, error: true };
  }
}

function fetchOne(s: StockDef): Promise<Quote> {
  if (s.kind === "kr_index") return fetchKrIndex(s);
  if (s.kind === "fx") return fetchFx(s);
  return fetchKrStock(s);
}

function formatPrice(p: number | null, decimals = 0): string {
  if (p == null || Number.isNaN(p)) return "—";
  return p.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function useKrxOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date());
      const get = (t: string) =>
        parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
      const weekday = parts.find((p) => p.type === "weekday")?.value;
      const mins = get("hour") * 60 + get("minute");
      const isOpen =
        !["Sat", "Sun"].includes(weekday ?? "") &&
        mins >= 9 * 60 &&
        mins <= 15 * 60 + 30;
      setOpen(isOpen);
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);
  return open;
}

export function WidgetWatchlist() {
  const [quotes, setQuotes] = useState<Quote[]>(
    STOCKS.map((s) => ({ ...s, price: null, changePct: null })),
  );
  const krxOpen = useKrxOpen();

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const results = await Promise.all(STOCKS.map(fetchOne));
      if (!cancelled) setQuotes(results);
    };
    fetchAll();
    const id = setInterval(fetchAll, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2 p-5">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-(--color-fg-2)">
          Watchlist
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-wider",
            krxOpen
              ? "bg-(--color-accent-soft) text-(--color-accent-strong)"
              : "bg-(--color-bg-2) text-(--color-fg-4)",
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              krxOpen ? "bg-(--color-accent)" : "bg-(--color-fg-4)",
            )}
          />
          {krxOpen ? "KRX OPEN" : "KRX CLOSED"}
        </span>
      </div>

      {quotes.map((q) => {
        const up = (q.changePct ?? 0) > 0;
        const down = (q.changePct ?? 0) < 0;
        const arrow = up ? "▲" : down ? "▼" : "·";
        // 한국식 표기: 상승=빨강, 하락=파랑 (테마와 무관한 고정색).
        const cls = up
          ? "text-[#e5484d]"
          : down
            ? "text-[#2f6fed]"
            : "text-(--color-fg-4)";

        return (
          <div
            key={q.id}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-0.5"
          >
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13px] text-(--color-fg)">
                {q.name}
              </div>
              <div className="truncate text-[10px] text-(--color-fg-4)">
                {q.exchange}
              </div>
            </div>
            <span className="font-mono text-[13px] tabular-nums text-(--color-fg)">
              {formatPrice(q.price, q.decimals)}
            </span>
            <span
              className={cn(
                "min-w-[56px] text-right font-mono text-[11px] tabular-nums",
                cls,
              )}
            >
              {q.price == null
                ? "·"
                : `${arrow} ${Math.abs(q.changePct ?? 0).toFixed(2)}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
