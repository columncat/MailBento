import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { listArchived, reorderArchived } from "@/lib/archive-server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orderedIds: z.array(z.number().int().positive()),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  reorderArchived(parsed.data.orderedIds);
  return NextResponse.json({ list: listArchived() });
}
