import { NextResponse } from "next/server";
import { z } from "zod";

import { encrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { setWidgetState } from "@/lib/widget-server";

export const dynamic = "force-dynamic";

const accountSchema = z.object({
  displayName: z.string().trim().min(1),
  email: z.string().trim(),
  displayEmail: z.string().nullish(),
  iconUrl: z.string().nullish(),
  webUrl: z.string().nullish(),
  query: z.string().nullish(),
  position: z.number().int().optional(),
  imapHost: z.string().nullish(),
  imapPort: z.number().int().nullish(),
  imapUsername: z.string().nullish(),
  imapPassword: z.string().nullish(),
});

const bodySchema = z.object({
  accounts: z.array(accountSchema).optional(),
  widget: z.unknown().optional(),
});

/**
 * 전체 설정 불러오기 — 계정을 통째로 교체(REPLACE)하고 위젯 상태를 덮어쓴다.
 * imapPassword(평문)는 이 인스턴스의 ENCRYPTION_KEY 로 다시 암호화해 저장.
 */
export async function PUT(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (parsed.accounts) {
    db.delete(schema.accounts).run();
    parsed.accounts.forEach((a, i) => {
      db.insert(schema.accounts)
        .values({
          provider: "imap",
          displayName: a.displayName,
          email: a.email,
          displayEmail: a.displayEmail ?? null,
          iconUrl: a.iconUrl ?? null,
          webUrl: a.webUrl ?? null,
          query: a.query ?? null,
          imapHost: a.imapHost ?? null,
          imapPort: a.imapPort ?? null,
          imapUsername: a.imapUsername ?? null,
          imapPasswordEnc: a.imapPassword ? encrypt(a.imapPassword) : null,
          position: a.position ?? i,
          updatedAt: new Date(),
        })
        .run();
    });
  }

  if (parsed.widget !== undefined) {
    setWidgetState(parsed.widget as Parameters<typeof setWidgetState>[0]);
  }

  return NextResponse.json({
    ok: true,
    accounts: parsed.accounts?.length ?? 0,
  });
}
