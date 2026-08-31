import { NextResponse, type NextRequest } from "next/server";

import {
  fetchRemoteImage,
  RemoteImageError,
  verifyImageSignature,
} from "@/lib/mail-image-proxy";

export const dynamic = "force-dynamic";

/**
 * 본문의 원격 그림을 **서버가 대신 받아** 내준다.
 *
 * 브라우저가 `https://발신자/track.png` 를 직접 부르면 발신자는 연 시각과 함께
 * 읽는 사람의 IP·브라우저·(주소에 심어 둔) 신원을 얻는다. 여기를 거치면
 * 발신자가 보는 것은 우리 서버의 IP 뿐이다.
 *
 * ── 주소를 왜 서명하는가 ──
 * 이 라우트는 "남이 적어 준 주소를 우리 서버가 부른다"는 뜻이라, 서명이 없으면
 * 사내망을 들여다보는 창이 된다. 서명은 그 주소가 **우리가 정제한 메일 본문에서
 * 나온 것**임을 증명한다. 서명만으로는 부족해서 실제 나가는 길에도 방어가
 * 있다(mail-image-proxy.ts) — 풀린 IP 검사, 리다이렉트마다 재검사, 크기·시간
 * 상한, 그리고 받아 온 것이 정말 그림인지 앞머리로 확인.
 *
 * 이 주소는 메일 본문에 그대로 굳는다(캐시·보관 사본). 그래서 계정 id 나 UID 를
 * 넣지 않았다 — 원본 메일이 IMAP 에서 사라지거나 계정을 지워도, 보관해 둔 사본의
 * 그림은 발신자 서버가 살아 있는 한 계속 뜬다. 보관함의 뜻이 그것이다.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("u");
  const sig = req.nextUrl.searchParams.get("s");
  if (!url || !sig) {
    return NextResponse.json({ error: "주소가 없습니다" }, { status: 400 });
  }
  if (!verifyImageSignature(url, sig)) {
    // 서명이 안 맞으면 부르지 않는다. 왜 안 맞는지는 말하지 않는다.
    return NextResponse.json({ error: "서명이 맞지 않습니다" }, { status: 403 });
  }

  try {
    const image = await fetchRemoteImage(url);
    return new Response(new Uint8Array(image.body), {
      headers: {
        // 선언이 아니라 **바이트를 보고** 정한 타입
        "content-type": image.contentType,
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
        /*
         * 브라우저가 담아 두게 한다. 캐시가 살아 있는 동안은 우리도 발신자를
         * 다시 부르지 않는다 — 같은 메일을 다시 열 때마다 발신자에게 신호가
         * 가는 것을 이 한 줄이 막는다.
         */
        "cache-control": "private, max-age=86400",
        // 우리 응답을 딛고 나가는 요청에도 출처를 흘리지 않는다
        "referrer-policy": "no-referrer",
      },
    });
  } catch (e) {
    if (e instanceof RemoteImageError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "그림을 받지 못했습니다" },
      { status: 502 },
    );
  }
}
