import { AppLayout } from "@/components/app-layout";
import { isAuthEnabled } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { getWidgetState } from "@/lib/widget-server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const widgetState = getWidgetState();
  const accounts = await db
    .select({
      id: schema.accounts.id,
      provider: schema.accounts.provider,
      displayName: schema.accounts.displayName,
      email: schema.accounts.email,
      iconUrl: schema.accounts.iconUrl,
      displayEmail: schema.accounts.displayEmail,
      webUrl: schema.accounts.webUrl,
    })
    .from(schema.accounts)
    .orderBy(schema.accounts.position)
    .all();

  return (
    <AppLayout
      initialAccounts={accounts}
      initialWidgetState={widgetState}
      refreshIntervalSeconds={env.REFRESH_INTERVAL_SECONDS}
      authEnabled={isAuthEnabled()}
    />
  );
}
