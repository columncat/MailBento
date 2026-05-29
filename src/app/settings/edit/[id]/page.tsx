import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProviderIcon } from "@/components/provider-icon";
import { db, schema } from "@/lib/db";

import { EditAccountForm } from "./form";

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const account = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, id))
    .get();
  if (!account) notFound();

  return (
    <main className="relative mx-auto flex min-h-screen max-w-[640px] flex-col gap-6 px-6 py-10">
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
            <ProviderIcon size={22} />
          </div>
          <div className="min-w-0">
            <h1
              className="text-xl leading-tight"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              계정 편집
            </h1>
            <p className="truncate text-[11.5px] text-(--color-fg-4)">
              {account.email}
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
        <EditAccountForm
          id={account.id}
          initialDisplayName={account.displayName}
          initialQuery={account.query}
          initialIconUrl={account.iconUrl}
          initialDisplayEmail={account.displayEmail}
          initialWebUrl={account.webUrl}
          realEmail={account.email}
        />
      </section>
    </main>
  );
}
