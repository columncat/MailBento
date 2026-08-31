import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { archiveMessage, listArchived } from "@/lib/archive-server";
import { db, schema } from "@/lib/db";
import { peekDetail } from "@/lib/message-detail-cache";
import { getProvider, isProviderImplemented } from "@/lib/providers";
import type { MailMessageDetail } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  accountId: z.number().int().positive(),
  messageId: z.string().min(1),
});

export async function GET() {
  return NextResponse.json({ archived: listArchived() });
}

/**
 * 메일 하나를 보관한다 — 사본을 통째로 뜬다.
 *
 * 본문은 클라이언트에서 받지 않는다. 목록 행에서 바로 보관하는 경우엔 화면에
 * 본문이 없기도 하고, 무엇보다 클라이언트가 보낸 HTML 을 그대로 저장하면
 * sanitize 를 우회하는 길이 열린다.
 *
 * ── 캐시가 있어도 IMAP 을 다시 치는 이유 ──
 * 화면용 본문은 인라인 그림을 `/api/mail/{계정}/{UID}/inline/…` 로 가리킨다.
 * 그 주소는 원본 메일이 서버에 있어야 뜻이 서고, 계정을 지우거나 메일이
 * 사라지거나 UIDVALIDITY 가 바뀌면 죽는다. 그런 본문을 그대로 굳히면
 * **"원본이 사라져도 남는 사본"이라는 보관함의 뜻이 깨진다.**
 *
 * 그래서 보관할 때는 인라인 그림을 `data:` 로 몸에 구운 판을 새로 받아 온다
 * (`inlineImages: "embed"`). 원격 그림(`http(s)`)은 그럴 필요가 없다 — 그쪽
 * 프록시 주소에는 원본 주소와 서명만 들어 있어 계정이 없어져도 그대로 산다.
 *
 * 받아 오지 못하면(이미 지워진 메일 등) 캐시에 남아 있는 화면용 본문으로
 * 물러선다. 그림 몇 장이 언젠가 깨지는 것이, 보관 자체가 안 되는 것보다 낫다.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { accountId, messageId } = parsed.data;

  const account = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .get();
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  if (!isProviderImplemented(account.provider)) {
    return NextResponse.json(
      { error: `${account.provider} not implemented` },
      { status: 501 },
    );
  }

  let detail: MailMessageDetail | null = null;
  let fetchError: string | null = null;
  try {
    detail = await getProvider(account.provider).fetchMessage(
      account,
      messageId,
      { inlineImages: "embed" },
    );
  } catch (e) {
    fetchError =
      e instanceof Error ? e.message : "메일을 가져오지 못했습니다";
  }

  /*
   * 이 판은 캐시에 담지 않는다.
   *
   * 캐시의 키는 (계정, UID) 하나뿐이라 두 판을 구분할 자리가 없다. 보관용
   * 본문을 담아 두면 다음에 그 메일을 열 때 `data:` 로 그림이 통째로 박힌
   * 본문이 나가고, 1MB 상한에 걸려 조용히 캐시가 안 되던 그 상태로 돌아간다.
   */
  if (!detail) detail = peekDetail(account, messageId);
  if (!detail) {
    return NextResponse.json(
      { error: fetchError ?? "메일을 가져오지 못해 보관하지 못했습니다" },
      { status: 502 },
    );
  }

  try {
    const saved = archiveMessage(account, detail);
    return NextResponse.json({ archived: saved, list: listArchived() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "보관 실패" },
      { status: 500 },
    );
  }
}
