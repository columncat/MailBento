import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  deleteArchived,
  getArchived,
  listArchived,
  setArchivedFlag,
  toMailDetail,
} from "@/lib/archive-server";
import { MESSAGE_MARKS } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  read: z.boolean().optional(),
  mark: z.enum(MESSAGE_MARKS).nullable().optional(),
});

function idOf(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * 보관본 열람.
 *
 * 라이브 경로(/api/mail/[accountId]/[messageId])를 쓰지 않는다. 그쪽은 계정을
 * 먼저 조회해 없으면 404 를 내고, IMAP 을 다시 치며, 열람과 동시에 읽음 표시를
 * 남긴다 — 셋 다 원본이 사라진 사본에는 맞지 않는다.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const id = idOf((await ctx.params).id);
  if (id == null) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const detail = getArchived(id);
  if (!detail) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    message: toMailDetail(detail),
    // 보관본의 표식은 사본 자신의 것이다 — message_flags 는 계정과 함께 사라진다
    flag: { read: detail.read, mark: detail.mark },
    archived: detail,
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const id = idOf((await ctx.params).id);
  if (id == null) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const updated = setArchivedFlag(id, parsed.data);
  if (!updated) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ archived: updated, list: listArchived() });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const id = idOf((await ctx.params).id);
  if (id == null) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  deleteArchived(id);
  return NextResponse.json({ list: listArchived() });
}
