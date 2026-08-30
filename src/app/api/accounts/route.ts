import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { invalidateMailCache } from "@/lib/mail-cache";
import { forgetAccountDetails } from "@/lib/message-detail-cache";

export async function GET() {
  const rows = await db
    .select({
      id: schema.accounts.id,
      provider: schema.accounts.provider,
      displayName: schema.accounts.displayName,
      email: schema.accounts.email,
      query: schema.accounts.query,
      position: schema.accounts.position,
      createdAt: schema.accounts.createdAt,
    })
    .from(schema.accounts)
    .orderBy(schema.accounts.position)
    .all();

  return NextResponse.json({ accounts: rows });
}

const patchSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  query: z.string().trim().nullable().optional(),
  iconUrl: z.string().trim().nullable().optional(),
  displayEmail: z.string().trim().nullable().optional(),
  webUrl: z.string().trim().nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const url = new URL(req.url);
  const idParam = url.searchParams.get("id");
  if (!idParam) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · ") },
      { status: 400 },
    );
  }

  /*
   * 고치기 전의 query. 아래에서 **정말 바뀌었을 때만** 본문 캐시를 턴다.
   *
   * 고치기 폼은 이름만 바꿔도 다섯 칸을 늘 함께 보낸다
   * (`settings/edit/[id]/form.tsx`). 그래서 "값이 왔는가" 로 판정하면 아이콘 하나
   * 바꾼 사람의 캐시 수십 통이 통째로 날아가고, 그다음 열기가 전부 IMAP 을 다시
   * 친다 — 이 캐시를 만든 이유가 그 왕복을 없애는 것이었다.
   */
  const before = await db
    .select({ query: schema.accounts.query })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, id))
    .get();

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.displayName !== undefined) {
    updates.displayName = parsed.data.displayName;
  }
  // 빈 문자열은 null 로 정규화 — provider 기본값으로 복귀
  const nullable = (v: string | null | undefined) =>
    v == null || v.length === 0 ? null : v;
  if (parsed.data.query !== undefined) {
    updates.query = nullable(parsed.data.query);
  }
  if (parsed.data.iconUrl !== undefined) {
    updates.iconUrl = nullable(parsed.data.iconUrl);
  }
  if (parsed.data.displayEmail !== undefined) {
    updates.displayEmail = nullable(parsed.data.displayEmail);
  }
  if (parsed.data.webUrl !== undefined) {
    updates.webUrl = nullable(parsed.data.webUrl);
  }

  await db
    .update(schema.accounts)
    .set(updates)
    .where(eq(schema.accounts.id, id))
    .run();

  invalidateMailCache();
  // 뷰가 보는 메일함(query 의 folder:)이 바뀌었을 수 있다. 옛 메일함의 본문이
  // 남의 본문으로 나가는 것은 캐시 쪽 지문 비교가 이미 막으므로 이건 정합성이
  // 아니라 정리다 — 이제 영영 적중할 수 없는 본문이 디스크에 30일이나 남아
  // 있을 이유가 없다. (여기서 안 불러도 틀린 본문은 나가지 않는다.)
  if (updates.query !== undefined && updates.query !== (before?.query ?? null)) {
    forgetAccountDetails(id);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const idParam = url.searchParams.get("id");
  if (!idParam) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await db.delete(schema.accounts).where(eq(schema.accounts.id, id)).run();
  invalidateMailCache();
  return NextResponse.json({ ok: true });
}
