import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";

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
  return NextResponse.json({ ok: true });
}
