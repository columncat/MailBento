import { ArrowLeft, Clock, LogOut, Mail, Plus } from "lucide-react";
import Link from "next/link";

import { ProviderIcon } from "@/components/provider-icon";
import { isAuthEnabled } from "@/lib/auth";
import { db, schema } from "@/lib/db";

import { AccountActions } from "./account-actions";
import { PreferencesPanel } from "./preferences-panel";
import { SettingsIO } from "./settings-io";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const { auth_error } = await searchParams;
  const authEnabled = isAuthEnabled();

  const accounts = await db
    .select()
    .from(schema.accounts)
    .orderBy(schema.accounts.position)
    .all();

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
        <div className="flex items-center gap-2">
          {authEnabled && (
            <>
              <Link
                href="/history"
                className="flex items-center gap-1.5 rounded-full bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)"
              >
                <Clock className="h-3.5 w-3.5" />
                로그인 기록
              </Link>
              <form action="/api/logout" method="POST">
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-full bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-danger)/15 hover:text-(--color-danger)"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  로그아웃
                </button>
              </form>
            </>
          )}
        </div>
      </header>

      <h1
        className="text-2xl leading-tight"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        설정
      </h1>

      {auth_error && (
        <div className="rounded-xl bg-(--color-surface) px-4 py-3 text-sm text-(--color-danger) ring-1 ring-(--color-danger)/40">
          연결 실패: <span className="font-mono">{auth_error}</span>
        </div>
      )}

      {/* IMAP 계정 / 메일박스 (뷰) */}
      <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-(--color-bg-2) ring-1 ring-(--color-border)">
              <ProviderIcon size={22} />
            </div>
            <div className="min-w-0">
              <div className="text-base font-medium text-(--color-fg)">
                메일박스 (IMAP)
              </div>
              <div className="text-xs text-(--color-fg-4)">
                IMAP + 앱 비밀번호. 복제 후 쿼리로 폴더/검색 뷰를 추가할 수 있음.
              </div>
            </div>
          </div>
          <Link
            href="/settings/imap"
            className="flex items-center gap-1.5 rounded-full bg-(--color-accent-soft) px-3.5 py-1.5 text-xs text-(--color-accent-strong) ring-1 ring-(--color-accent)/40 hover:bg-(--color-accent)/25"
          >
            <Plus className="h-3.5 w-3.5" />
            계정 추가
          </Link>
        </header>

        {accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-(--color-border) py-8 text-center text-xs text-(--color-fg-4)">
            <Mail className="mx-auto mb-2 h-4 w-4" />
            연결된 메일박스 없음 — “계정 추가” 또는 설정 불러오기로 시작하세요.
          </div>
        ) : (
          <ul className="divide-y divide-(--color-border-soft)">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-(--color-bg-2) ring-1 ring-(--color-border)">
                  <ProviderIcon overrideUrl={a.iconUrl} size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-(--color-fg)">
                      {a.displayName}
                    </span>
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
                <AccountActions id={a.id} email={a.email} canDuplicate />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 표시 설정 */}
      <PreferencesPanel />

      {/* 설정 백업 (계정 + 위젯 + 표시설정 전체) */}
      <SettingsIO />
    </main>
  );
}
