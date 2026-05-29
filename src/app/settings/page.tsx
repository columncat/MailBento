import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";

import { ProviderIcon } from "@/components/provider-icon";
import { db, schema } from "@/lib/db";
import type { Account, Provider } from "@/lib/db/schema";

import { AccountActions } from "./account-actions";
import { ConnectButton, type ConnectOption } from "./connect-button";
import { SettingsIO } from "./settings-io";

interface SectionDef {
  /** 섹션 아이콘 표시에 쓸 대표 provider 값. */
  iconProvider: Provider;
  label: string;
  description: string;
  /** 이 섹션에 묶을 provider 들. */
  providers: Provider[];
  connect: ConnectOption[];
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const { auth_error } = await searchParams;

  const accounts = await db
    .select()
    .from(schema.accounts)
    .orderBy(schema.accounts.position)
    .all();

  const sections: SectionDef[] = [
    {
      iconProvider: "gmail",
      label: "Gmail",
      description: "Google OAuth · Gmail API (read-only)",
      providers: ["gmail"],
      connect: [{ label: "Gmail 연결", href: "/api/auth/google" }],
    },
    {
      iconProvider: "outlook",
      label: "Outlook",
      description: "Microsoft Outlook / Office 365 — Graph API 또는 IMAP",
      providers: ["outlook", "outlook_imap"],
      connect: [
        {
          label: "Microsoft Graph API",
          description: "개인 Outlook · 가장 권장되는 방식",
          href: "/api/auth/microsoft",
        },
        {
          label: "IMAP via OAuth (XOAUTH2)",
          description: "학교/회사 Office 365 — Graph 가 막혀있을 때",
          href: "/api/auth/microsoft-imap",
        },
      ],
    },
    {
      iconProvider: "imap",
      label: "IMAP",
      description:
        "Naver · iCloud · Yandex · Fastmail · 기타 IMAP — 앱 비밀번호 인증",
      providers: ["naver", "imap"],
      connect: [{ label: "IMAP 계정 추가", href: "/settings/imap" }],
    },
  ];

  return (
    <main className="relative mx-auto flex min-h-screen max-w-[860px] flex-col gap-6 px-6 py-10 lg:px-0">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-(--color-fg-3) hover:text-(--color-fg)"
        >
          <ArrowLeft className="h-4 w-4" />
          대시보드로
        </Link>
        <h1
          className="text-2xl leading-tight"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          계정 관리
        </h1>
      </header>

      {auth_error && (
        <div className="rounded-xl bg-(--color-surface) px-4 py-3 text-sm text-(--color-danger) ring-1 ring-(--color-danger)/40">
          연결 실패: <span className="font-mono">{auth_error}</span>
        </div>
      )}

      {sections.map((s) => (
        <Section
          key={s.label}
          def={s}
          accounts={accounts.filter((a) => s.providers.includes(a.provider))}
        />
      ))}

      <SettingsIO />
    </main>
  );
}

function Section({
  def,
  accounts,
}: {
  def: SectionDef;
  accounts: Account[];
}) {
  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-(--color-bg-2) ring-1 ring-(--color-border)">
            <ProviderIcon provider={def.iconProvider} size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-base font-medium text-(--color-fg)">
              {def.label}
            </div>
            <div className="text-xs text-(--color-fg-4)">{def.description}</div>
          </div>
        </div>
        <ConnectButton options={def.connect} />
      </header>

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-(--color-border) py-6 text-center text-xs text-(--color-fg-4)">
          <Mail className="mx-auto mb-2 h-4 w-4" />
          연결된 계정 없음
        </div>
      ) : (
        <ul className="divide-y divide-(--color-border-soft)">
          {accounts.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 py-2.5"
            >
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-(--color-bg-2) ring-1 ring-(--color-border)">
                <ProviderIcon provider={a.provider} size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-(--color-fg)">
                    {a.displayName}
                  </span>
                  <SubBadge provider={a.provider} />
                  {a.query && (
                    <span
                      className="truncate rounded-md bg-(--color-bg-2) px-1.5 py-0.5 font-mono text-[10px] text-(--color-fg-3) ring-1 ring-(--color-border-soft)"
                      title={a.query}
                    >
                      {a.query}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-(--color-fg-4)">
                  {a.email}
                </div>
              </div>
              <AccountActions
                id={a.id}
                email={a.email}
                canDuplicate={a.provider === "gmail"}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SubBadge({ provider }: { provider: Provider }) {
  const text =
    provider === "outlook"
      ? "Graph"
      : provider === "outlook_imap"
        ? "IMAP"
        : provider === "naver"
          ? "Naver"
          : null;
  if (!text) return null;
  return (
    <span className="rounded-full bg-(--color-bg-2) px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-(--color-fg-4) ring-1 ring-(--color-border-soft)">
      {text}
    </span>
  );
}
