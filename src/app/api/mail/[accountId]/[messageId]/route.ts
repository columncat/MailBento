import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { MESSAGE_MARKS } from "@/lib/db/schema";
import { setFlag } from "@/lib/message-flags";
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
    // 열람 = 읽음. 서버의 \Seen 은 건드리지 않고 앱 안에서만 표시한다.
    const flag = setFlag(id, decodeURIComponent(messageId), { read: true });
    return NextResponse.json({
      message: { ...message, unread: false, mark: flag.mark },
      flag,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  read: z.boolean().optional(),
  /** null 을 보내면 표식 해제. */
  mark: z.enum(MESSAGE_MARKS).nullable().optional(),
});

/** 앱 내부 표식 갱신 (읽음 / 마크). IMAP 서버 상태는 바뀌지 않는다. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ accountId: string; messageId: string }> },
) {
  const { accountId, messageId } = await ctx.params;
  const id = Number(accountId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid account id" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const account = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, id))
    .get();
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const flag = setFlag(id, decodeURIComponent(messageId), parsed.data);
  return NextResponse.json({ flag });
}
