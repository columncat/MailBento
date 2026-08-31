import { NextResponse, type NextRequest } from "next/server";

import {
  contentDisposition,
  PartError,
  resolveTarget,
  streamMessagePart,
} from "@/lib/mail-part";

export const dynamic = "force-dynamic";

/**
 * 첨부 하나를 내려받는다.
 *
 * **여기 오기 전까지 그 바이트는 어디에도 없었다.** 자동 수집은 봉투만 받고,
 * 메일을 열어도 목록(이름·크기·종류)만 만들어진다. 사람이 단추를 누른 이 순간에
 * IMAP 이 그 조각만 보내 주고, 우리는 그것을 응답으로 곧장 흘려보낸다 —
 * 디스크에 쓰지 않고, 다 모으지도 않는다.
 *
 * ── Content-Type 을 왜 발신자 말대로 안 쓰는가 ──
 * 파트 헤더의 `Content-Type` 은 메일을 보낸 사람이 적는 값이다. 그것을 그대로
 * 응답에 실으면 우리 오리진이 `text/html` 이나 `image/svg+xml` 을 내보내게 되고,
 * 그 안의 스크립트는 우리 앱과 **같은 오리진**에서 돌아 세션 쿠키에 닿는다.
 * 내려받기에는 진짜 타입이 필요하지도 않다 — 파일은 디스크로 가고, 무엇으로 열지는
 * 이름의 확장자를 보고 운영체제가 정한다. 그래서 전부
 * `application/octet-stream` 으로 내보내고 `nosniff` 로 브라우저의 추측도 막는다.
 * 사람에게 보여 줄 "PDF 문서" 같은 말은 목록의 `contentType` 이 이미 들고 있다.
 */
export async function GET(
  _req: NextRequest,
  ctx: {
    params: Promise<{ accountId: string; messageId: string; part: string }>;
  },
) {
  const { accountId, messageId, part } = await ctx.params;

  try {
    const { account, uid } = resolveTarget(accountId, messageId);
    const got = await streamMessagePart(
      account,
      uid,
      decodeURIComponent(part),
    );

    return new Response(got.stream, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": contentDisposition("attachment", got.filename),
        "x-content-type-options": "nosniff",
        /*
         * 담아 두지 않는다. 첨부 바이트는 우리 디스크에도 캐시에도 남지 않기로
         * 한 것이라, 브라우저의 디스크 캐시에 남는 것도 같은 결로 막는다.
         * (사람이 저장한 파일은 물론 그 사람 것이다.)
         */
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof PartError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "첨부를 받지 못했습니다" },
      { status: 502 },
    );
  }
}
