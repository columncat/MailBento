import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";

const bodySchema = z.object({
  orderedIds: z.array(z.number().int().positive()),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { orderedIds } = parsed.data;

  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(schema.accounts)
      .set({ position: i, updatedAt: new Date() })
      .where(eq(schema.accounts.id, orderedIds[i]))
      .run();
  }

  return NextResponse.json({ ok: true, count: orderedIds.length });
}
