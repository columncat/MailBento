import { NextResponse, type NextRequest } from "next/server";

import { sniffImageType } from "@/lib/image-bytes";
import {
  contentDisposition,
  MAX_INLINE_BYTES,
  PartError,
  readMessagePart,
  resolveTarget,
} from "@/lib/mail-part";

export const dynamic = "force-dynamic";

/**
 * 본문에 박힌 인라인 그림 하나 (`cid:` 가 가리키는 조각).
 *
 * 정제 단계에서 `cid:logo@x` 를 이 주소로 바꿔 두었다. 그 전에는 mailparser 가
 * `data:` 로 본문에 통째로 구워 넣었는데, 그러면 그림 한 장이 1MB 캐시 상한을
 * 넘겨 그 메일이 영영 캐시를 못 타고 — 그 사실이 아무 데도 안 남았다.
 *
 * ── 타입을 왜 다시 정하는가 ──
 * 파트 헤더의 `Content-Type` 은 발신자가 적는 값이다. `image/svg+xml` 이라고
 * 적힌 조각을 그 말대로 내보내면, SVG 안의 `<script>` 가 **우리 오리진에서**
 * 돈다. 그래서 받아 온 바이트의 앞머리를 직접 보고(sniffImageType) 아는 래스터
 * 그림일 때만, 거기서 알아낸 타입으로 내보낸다. SVG 는 글자로 된 형식이라
 * 어떤 마법 바이트와도 안 맞아 자연히 걸린다.
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
    const got = await readMessagePart(
      account,
      uid,
      decodeURIComponent(part),
      MAX_INLINE_BYTES,
    );

    const contentType = sniffImageType(got.body);
    if (!contentType) {
      return NextResponse.json(
        { error: "그림이 아닙니다" },
        { status: 415 },
      );
    }

    return new Response(new Uint8Array(got.body), {
      headers: {
        "content-type": contentType,
        "content-disposition": contentDisposition("inline", got.filename),
        "x-content-type-options": "nosniff",
        /*
         * 브라우저가 담아 두게 한다.
         *
         * 같은 메일을 다시 열 때마다 IMAP 을 왕복할 이유가 없다. `private` 는
         * 중간 캐시가 아니라 그 사람의 브라우저에만 남으라는 뜻이다. UID 는
         * UIDVALIDITY 가 바뀌면 다른 메일에 재사용될 수 있어서 영원히 두지는
         * 않는다 — 한 시간이면 다시 여는 동안은 안 물어보고, 그 창은 닫힌다.
         */
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (e) {
    if (e instanceof PartError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "그림을 받지 못했습니다" },
      { status: 502 },
    );
  }
}
