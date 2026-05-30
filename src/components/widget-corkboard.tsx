"use client";

import { ExternalLink, Pin, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  autoIconUrl,
  hostnameOf,
  uid,
  type Pin as PinType,
} from "@/lib/widget-storage";

interface Props {
  pins: PinType[];
  onChange: (pins: PinType[]) => void;
}

export function WidgetCorkboard({ pins, onChange }: Props) {
  const [input, setInput] = useState("");

  const addPin = (e: React.FormEvent) => {
    e.preventDefault();
    const url = input.trim();
    if (!url) return;
    try {
      const u = new URL(url.startsWith("http") ? url : `https://${url}`);
      const newPin: PinType = {
        id: uid(),
        url: u.toString(),
        title: u.hostname,
        iconUrl: autoIconUrl(u.toString()),
      };
      onChange([...pins, newPin]);
      setInput("");
    } catch {
      /* invalid URL */
    }
  };

  const removePin = (id: string) => {
    onChange(pins.filter((p) => p.id !== id));
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-[var(--radius-card)] bg-(--color-surface) p-5 ring-1 ring-(--color-border-soft)">
      <header className="mb-3 flex shrink-0 items-center justify-between">
        <h2
          className="text-xl leading-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Corkboard
        </h2>
        <span className="font-mono text-[11px] text-(--color-fg-4)">
          {String(pins.length).padStart(2, "0")} PINNED
        </span>
      </header>

      <form onSubmit={addPin} className="mb-3 flex shrink-0 gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://example.com"
          className="flex-1 rounded-lg bg-(--color-bg-2) px-3 py-2 text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60"
        />
        <button
          type="submit"
          className="rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-medium text-(--color-bg) hover:bg-(--color-accent-strong)"
        >
          + 추가
        </button>
      </form>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      {pins.length === 0 ? (
        <div className="rounded-lg border border-dashed border-(--color-border) py-6 text-center text-sm text-(--color-fg-4)">
          <Pin className="mx-auto mb-1.5 h-4 w-4" />
          핀이 없습니다
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {pins.map((pin) => (
            <li
              key={pin.id}
              className="group flex items-center gap-2.5 rounded-lg bg-(--color-bg-2) p-2.5 ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pin.iconUrl || autoIconUrl(pin.url)}
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 shrink-0 rounded object-contain"
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
              />
              <a
                href={pin.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 flex-1 items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-(--color-fg)">
                    {hostnameOf(pin.url)}
                  </div>
                  <div className="truncate font-mono text-[11px] text-(--color-fg-4)">
                    {pin.url}
                  </div>
                </div>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-(--color-fg-4) opacity-0 group-hover:opacity-100" />
              </a>
              <button
                type="button"
                onClick={() => removePin(pin.id)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-(--color-fg-4) opacity-0 transition group-hover:opacity-100 hover:bg-(--color-danger)/20 hover:text-(--color-danger)"
                aria-label="핀 삭제"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </section>
  );
}
