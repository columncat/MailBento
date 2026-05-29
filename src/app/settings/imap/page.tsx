import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ProviderIcon } from "@/components/provider-icon";

import { ImapForm } from "./form";

export default function ImapSettingsPage() {
  return (
    <main className="relative mx-auto flex min-h-screen max-w-[560px] flex-col gap-6 px-6 py-10">
      <header className="flex items-center gap-3">
        <Link
          href="/settings"
          className="grid h-9 w-9 place-items-center rounded-lg text-(--color-fg-3) hover:bg-(--color-surface) hover:text-(--color-fg)"
          aria-label="설정으로 돌아가기"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-(--color-surface) ring-1 ring-(--color-border)">
            <ProviderIcon provider="imap" size={22} />
          </div>
          <div>
            <h1
              className="text-xl leading-tight"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              IMAP 계정 추가
            </h1>
            <p className="text-[11.5px] text-(--color-fg-4)">
              아래 "서비스" 에서 자주 쓰는 IMAP 서버를 선택하거나 직접 입력하세요.
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
        <ImapForm />
      </section>
    </main>
  );
}
