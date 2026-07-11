import { NextResponse } from "next/server";
import { z } from "zod";

import { getAppConfig, setAppConfig } from "@/lib/app-config";
import { invalidateMailCache } from "@/lib/mail-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getAppConfig());
}

const bodySchema = z.object({
  mailCacheSeconds: z.number().int().min(0).max(3600).optional(),
});

export async function PUT(req: Request) {
  let body;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const saved = setAppConfig(body);
  invalidateMailCache(); // 새 TTL 즉시 반영
  return NextResponse.json(saved);
}
