import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db, schema } from "@/lib/db";
import { getProvider, isProviderImplemented } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ accountId: string; messageId: string }> },
) {
  const { accountId, messageId } = await ctx.params;
  const id = Number(accountId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid account id" }, { status: 400 });
  }

  const account = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, id))
    .get();
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }
  if (!isProviderImplemented(account.provider)) {
    return NextResponse.json(
      { error: `${account.provider} not implemented` },
      { status: 501 },
    );
  }

  try {
    const provider = getProvider(account.provider);
    const message = await provider.fetchMessage(
      account,
      decodeURIComponent(messageId),
    );
    return NextResponse.json({ message });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
