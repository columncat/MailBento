"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Plus } from "lucide-react";
import Link from "next/link";

export interface ConnectOption {
  label: string;
  description?: string;
  href: string;
}

const TRIGGER_CLS =
  "flex items-center gap-1.5 rounded-full bg-(--color-accent-soft) px-3.5 py-1.5 text-xs text-(--color-accent-strong) ring-1 ring-(--color-accent)/40 hover:bg-(--color-accent)/25 outline-none";

export function ConnectButton({ options }: { options: ConnectOption[] }) {
  if (options.length === 0) {
    return (
      <span className="rounded-full bg-(--color-bg-2) px-3 py-1.5 text-xs text-(--color-fg-4) ring-1 ring-(--color-border)">
        준비 중
      </span>
    );
  }

  if (options.length === 1) {
    return (
      <Link href={options[0].href} className={TRIGGER_CLS}>
        <Plus className="h-3.5 w-3.5" />
        연결
      </Link>
    );
  }

  return (
    <DM.Root>
      <DM.Trigger className={TRIGGER_CLS}>
        <Plus className="h-3.5 w-3.5" />
        연결
        <ChevronDown className="h-3 w-3 opacity-70" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[280px] rounded-xl bg-(--color-surface-2) p-1.5 shadow-2xl ring-1 ring-(--color-border) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {options.map((opt) => (
            <DM.Item key={opt.href} asChild>
              <Link
                href={opt.href}
                className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5 outline-none data-[highlighted]:bg-(--color-surface-hi)"
              >
                <span className="text-sm font-medium text-(--color-fg)">
                  {opt.label}
                </span>
                {opt.description && (
                  <span className="text-[11px] text-(--color-fg-4)">
                    {opt.description}
                  </span>
                )}
              </Link>
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
