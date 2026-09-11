import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { MESSAGE_MARKS } from "@/lib/db/schema";
import { imapErrorDetail } from "@/lib/imap-error";
import { peekDetail, rememberDetail } from "@/lib/message-detail-cache";
import { setFlag } from "@/lib/message-flags";
import { getProvider, isProviderImplemented } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ accountId: string; messageId: string }> },
) {
  const { accountId, messageId } = await ctx.params;
  const id = Number(accountId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid account id" }, { status: 400 });
  }

  const account = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, id))
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

  const uid = decodeURIComponent(messageId);
  const started = Date.now();
  let tooBig = false;

  try {
    // 한 번 받아 둔 본문이 있으면 IMAP 을 아예 치지 않는다 — 두 번째 열기가
    // 빠른 이유가 여기다. 없으면 받아 와서 다음을 위해 담아 둔다.
    let message = peekDetail(account, uid);
    const hit = message !== null;
    if (!message) {
      message = await getProvider(account.provider).fetchMessage(account, uid);
      /*
       * 반환값을 본다. 통당 상한(1MB)에 걸려 안 담긴 본문은 **열 때마다**
       * IMAP 왕복을 새로 하는데, 앞에서는 그 사실이 어디에도 안 남았다.
       * (수집기 쪽은 `tooBig` 로 세기라도 한다.)
       */
      if (!rememberDetail(account, uid, message)) tooBig = true;
    }
    // 빨라졌는지 재려면 남아 있어야 한다. 적중률이 낮으면 상한/TTL 을 의심할 것.
    console.log(
      `[mail] 본문 ${hit ? "캐시" : "IMAP"} account=${id} uid=${uid} ${
        Date.now() - started
      }ms` + (tooBig ? " (커서 캐시에 못 담았다 — 열 때마다 다시 받는다)" : ""),
    );

    // 열람 = 읽음. 서버의 \Seen 은 건드리지 않고 앱 안에서만 표시한다.
    // 캐시로 답할 때도 똑같이 돈다 — 여는 것이 곧 읽음이다.
    const flag = setFlag(id, uid, { read: true });
    return NextResponse.json({
      // 읽음·표식은 본문과 따로 산다. 캐시에 담긴 옛 unread/mark 가 되살아나지
      // 않도록 message_flags 에서 읽은 값으로 덮어 얹는다.
      message: { ...message, unread: false, mark: flag.mark },
      flag,
    });
  } catch (err) {
    /*
     * **실패도 한 줄 남긴다.** 앞에서는 이 catch 가 500 만 내고 로그를 한 줄도
     * 안 남겼다. 그래서 사람이 겪은 실패는 이 앱의 로그에서 자기 줄을 못 갖고,
     * 옆에 있는 `[mail] 본문 내역` 만 남아 그것이 성공처럼 읽혔다.
     */
    console.warn(
      `[mail] 본문 실패 account=${id} uid=${uid} ${Date.now() - started}ms ` +
        imapErrorDetail(err),
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  read: z.boolean().optional(),
  /** null 을 보내면 표식 해제. */
  mark: z.enum(MESSAGE_MARKS).nullable().optional(),
});

/** 앱 내부 표식 갱신 (읽음 / 마크). IMAP 서버 상태는 바뀌지 않는다. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ accountId: string; messageId: string }> },
) {
  const { accountId, messageId } = await ctx.params;
  const id = Number(accountId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid account id" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const account = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, id))
    .get();
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const flag = setFlag(id, decodeURIComponent(messageId), parsed.data);
  return NextResponse.json({ flag });
}
