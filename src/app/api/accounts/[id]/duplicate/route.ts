import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db, schema } from "@/lib/db";

/**
 * 계정을 복제. OAuth 자격증명 (token / IMAP 비밀번호) 그대로 복사 →
 * 같은 메일 계정의 다른 "뷰" (다른 query) 를 만드는 용도.
 *
 * Gmail 처럼 토큰을 자동 갱신하는 provider 는 어느 row 에서 refresh 가 일어나도
 * 같은 (provider, email) 의 모든 row 가 함께 갱신됨 → 토큰 동기화 OK.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idParam } = await ctx.params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const orig = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, id))
    .get();
  if (!orig) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const all = await db
    .select({ position: schema.accounts.position })
    .from(schema.accounts)
    .all();
  const maxPos = all.reduce((m, r) => Math.max(m, r.position), -1);

  const result = await db
    .insert(schema.accounts)
    .values({
      provider: orig.provider,
      displayName: `${orig.displayName} (복제)`,
      email: orig.email,
      accessTokenEnc: orig.accessTokenEnc,
      refreshTokenEnc: orig.refreshTokenEnc,
      expiresAt: orig.expiresAt,
      imapHost: orig.imapHost,
      imapPort: orig.imapPort,
      imapUsername: orig.imapUsername,
      imapPasswordEnc: orig.imapPasswordEnc,
      query: orig.query,
      position: maxPos + 1,
      updatedAt: new Date(),
    })
    .returning({ id: schema.accounts.id })
    .all();

  return NextResponse.json({ id: result[0].id });
}
