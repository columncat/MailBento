import { NextResponse } from "next/server";

import { getWidgetState, setWidgetState } from "@/lib/widget-server";
import type { WidgetState } from "@/lib/widget-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getWidgetState());
}

export async function PUT(req: Request) {
  let body: Partial<WidgetState>;
  try {
    body = (await req.json()) as Partial<WidgetState>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const saved = setWidgetState(body);
  return NextResponse.json(saved);
}
