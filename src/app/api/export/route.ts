import { NextResponse } from "next/server";

import { decrypt } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { getWidgetState } from "@/lib/widget-server";

export const dynamic = "force-dynamic";

/**
 * 전체 설정 내보내기 — 계정(IMAP, 평문 비밀번호 포함) + 위젯 상태.
 * 평문 비밀번호가 포함되므로 결과 파일은 안전하게 보관해야 함.
 */
export async function GET() {
  const rows = await db
    .select()
    .from(schema.accounts)
    .orderBy(schema.accounts.position)
    .all();

  const accounts = rows.map((a) => ({
    displayName: a.displayName,
    email: a.email,
    displayEmail: a.displayEmail,
    iconUrl: a.iconUrl,
    webUrl: a.webUrl,
    query: a.query,
    position: a.position,
    imapHost: a.imapHost,
    imapPort: a.imapPort,
    imapUsername: a.imapUsername,
    imapPassword: a.imapPasswordEnc ? decrypt(a.imapPasswordEnc) : null,
  }));

  return NextResponse.json({
    app: "mailbento",
    type: "backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    accounts,
    widget: getWidgetState(),
  });
}
