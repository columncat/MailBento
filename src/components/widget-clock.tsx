"use client";

import { useEffect, useState } from "react";

import { wttrEmoji, type Region } from "@/lib/widget-config";

interface Weather {
  tempC: number;
  tempF: number;
  code: string;
  desc: string;
  isDay: boolean;
}

export function WidgetClock({ region }: { region: Region }) {
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchWeather = async () => {
      try {
        const r = await fetch(
          `https://wttr.in/${region.weatherQuery}?format=j1`,
          { cache: "no-store" },
        );
        const j = await r.json();
        const c = j.current_condition?.[0];
        if (!c) return;
        const hour = parseInt(
          new Intl.DateTimeFormat("en-US", {
            timeZone: region.tz,
            hour: "2-digit",
            hourCycle: "h23",
          }).format(new Date()),
          10,
        );
        if (cancelled) return;
        setWeather({
          tempC: parseFloat(c.temp_C),
          tempF: parseFloat(c.temp_F),
          code: c.weatherCode,
          desc:
            c.lang_ko?.[0]?.value || c.weatherDesc?.[0]?.value || "",
          isDay: hour >= 6 && hour < 19,
        });
      } catch {
        /* */
      }
    };
    fetchWeather();
    const id = setInterval(fetchWeather, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [region.weatherQuery, region.tz]);

  const hm = new Intl.DateTimeFormat(region.locale, {
    timeZone: region.tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const sec = new Intl.DateTimeFormat(region.locale, {
    timeZone: region.tz,
    second: "2-digit",
  }).format(now);
  const dateStr = new Intl.DateTimeFormat(region.locale, {
    timeZone: region.tz,
    weekday: "short",
    month: "short",
    day: "2-digit",
  }).format(now);

  const temp = weather
    ? region.unit === "F"
      ? `${Math.round(weather.tempF)}°F`
      : `${Math.round(weather.tempC)}°C`
    : "—";

  return (
    <div className="flex h-full min-w-0 flex-col gap-2.5 p-5">
      {/* 상단 라벨: 깃발 + 타임존 (Search 제목 행과 정렬) */}
      <div className="flex h-6 shrink-0 items-center gap-2.5">
        <span className="inline-flex shrink-0 items-center rounded-md border border-(--color-border) bg-(--color-bg-2) px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-(--color-fg-2)">
          {region.flag}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] tracking-[0.22em] uppercase text-(--color-fg-2)">
          {region.tzLabel}
        </span>
      </div>

      {/* 3행 Bento — Google/Naver/Youtube 검색창 높이에 정렬 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        {/* 행 A (Google 높이): 도시명(좌측) / 위·경도(우측) */}
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <span className="max-w-full truncate text-left text-[15px] font-medium text-(--color-fg)">
            {region.cityKor}
          </span>
          <span className="self-end text-right font-mono text-[10.5px] text-(--color-fg-4)">
            {region.coords}
          </span>
        </div>

        {/* 행 B (Naver 높이): 시간 */}
        <div className="flex min-h-0 flex-1 items-center">
          <span className="font-mono text-[42px] leading-none font-light text-(--color-fg) tabular-nums">
            {hm}
          </span>
          <span className="ml-1 font-mono text-[14px] leading-none text-(--color-fg-3) tabular-nums">
            :{sec}
          </span>
        </div>

        {/* 행 C (Youtube 높이): 날씨 + 날짜 */}
        <div className="flex min-h-0 flex-1 items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none">
              {weather ? wttrEmoji(weather.code, weather.isDay) : "·"}
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-(--color-fg)">
                {temp}
              </span>
              <span className="text-[10px] text-(--color-fg-4)">
                {weather?.desc || "·"}
              </span>
            </div>
          </div>
          <span className="font-mono text-[10.5px] text-(--color-fg-4)">
            {dateStr}
          </span>
        </div>
      </div>
    </div>
  );
}
