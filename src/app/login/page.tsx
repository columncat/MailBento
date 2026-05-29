import { Mail } from "lucide-react";

import { isAuthEnabled } from "@/lib/auth";
import { redirect } from "next/navigation";

import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  if (!isAuthEnabled()) {
    redirect("/");
  }
  const { from } = await searchParams;
  const to = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";

  return (
    <main className="relative mx-auto flex min-h-screen max-w-[400px] flex-col items-center justify-center gap-6 px-6 py-10">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-(--color-surface) ring-1 ring-(--color-border-soft)">
          <Mail className="h-6 w-6 text-(--color-accent)" />
        </div>
        <div>
          <h1
            className="text-2xl leading-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            MailBento
          </h1>
          <p className="text-xs text-(--color-fg-4)">대시보드 접근에 비밀번호 필요</p>
        </div>
      </div>

      <section className="w-full rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
        <LoginForm to={to} />
      </section>
    </main>
  );
}
