import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { archiveMessage, listArchived } from "@/lib/archive-server";
import { db, schema } from "@/lib/db";
import { peekDetail, rememberDetail } from "@/lib/message-detail-cache";
import { getProvider, isProviderImplemented } from "@/lib/providers";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  accountId: z.number().int().positive(),
  messageId: z.string().min(1),
});

export async function GET() {
  return NextResponse.json({ archived: listArchived() });
}

/**
 * 메일 하나를 보관한다 — 사본을 통째로 뜬다.
 *
 * 본문은 클라이언트에서 받지 않는다. 목록 행에서 바로 보관하는 경우엔 화면에
 * 본문이 없기도 하고, 무엇보다 클라이언트가 보낸 HTML 을 그대로 저장하면
 * sanitize 를 우회하는 길이 열린다. 방금 열어 본 것이면 서버 기억에서, 아니면
 * IMAP 에서 다시 받아 온다.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { accountId, messageId } = parsed.data;

  const account = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .get();
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  let detail = peekDetail(accountId, messageId);
  if (!detail) {
    if (!isProviderImplemented(account.provider)) {
      return NextResponse.json(
        { error: `${account.provider} not implemented` },
        { status: 501 },
      );
    }
    try {
      detail = await getProvider(account.provider).fetchMessage(
        account,
        messageId,
      );
      rememberDetail(accountId, messageId, detail);
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error ? e.message : "메일을 가져오지 못해 보관하지 못했습니다",
        },
        { status: 502 },
      );
    }
  }

  try {
    const saved = archiveMessage(account, detail);
    return NextResponse.json({ archived: saved, list: listArchived() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "보관 실패" },
      { status: 500 },
    );
  }
}
