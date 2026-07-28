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
  refreshIntervalSeconds: z.number().int().min(15).max(3600).optional(),
  forceOnInterval: z.boolean().optional(),
  /** 지역 목록. 서버에서 정규화하므로 형태는 느슨하게 받는다. */
  regions: z.array(z.unknown()).optional(),
});

export async function PUT(req: Request) {
  let body;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const saved = setAppConfig(body as Parameters<typeof setAppConfig>[0]);
  invalidateMailCache(); // 새 TTL 즉시 반영
  return NextResponse.json(saved);
}
