import { NextResponse } from "next/server";

import { databaseFileBytes, reclaimDiskSpace } from "@/lib/db";
import { clearDetailCache, detailCacheStats } from "@/lib/message-detail-cache";

export const dynamic = "force-dynamic";

/** 지금 담겨 있는 본문의 통수·크기와 DB 파일 크기. */
export async function GET() {
  return NextResponse.json({
    stats: detailCacheStats(),
    fileBytes: databaseFileBytes(),
  });
}

/**
 * 본문 캐시를 비운다.
 *
 * 봉투 캐시에는 invalidateMailCache() 라는 손잡이가 있고 계정 PATCH/DELETE/
 * 불러오기가 전부 그것을 부르는데, 본문 캐시에는 대응물이 없었다. 뭔가
 * 이상해 보일 때 사람이 할 수 있는 일이 "계정을 통째로 지우거나 30일 기다리기"
 * 뿐이었고, 계정을 지우면 보관함의 source_account_id 까지 null 이 된다.
 *
 * 비운 김에 파일에서 공간도 돌려받는다(VACUUM). 행만 지우면 SQLite 파일은
 * 줄지 않아서, 한 번 커진 mailbento.db 가 영영 그 크기로 남는다. 담긴 게
 * 없어도 판다 — 지난번에 커진 파일을 되돌리는 것이 이 버튼을 누르는 이유일 수
 * 있고, 이미 지워진 본문의 잔류물도 그때 함께 사라진다.
 */
export async function DELETE() {
  /*
   * 파일 크기는 **지우기 전에** 잰다.
   *
   * 지우고 나서 재면 그 DELETE 가 방금 WAL 에 써 넣은 만큼이 얹힌다. 150KB
   * 짜리 100통을 담아 두고 재 봤더니 설정 화면이 조금 전 보여 준 값은
   * 14.6MB 인데 지운 뒤 잰 값은 29.1MB — 딱 두 배였다. 그대로 내보내면
   * "14.6MB 라더니 29.1MB → 0.1MB 로 줄였다" 는 말이 되어, 화면이 스스로
   * 보여 준 숫자와 어긋나고 되찾은 공간이 실제보다 커 보인다.
   */
  const before = databaseFileBytes();
  const cleared = clearDetailCache();
  try {
    return NextResponse.json({
      cleared,
      file: { before, after: reclaimDiskSpace().after },
    });
  } catch (e) {
    // 비우기는 이미 끝났다. 공간을 못 돌려받았다고 500 을 주면(디스크 여유가
    // 없거나 다른 프로세스가 붙잡고 있을 때) 사람은 지워지긴 한 건지 알 수 없다.
    console.warn("[mailbento] VACUUM 실패 (캐시는 비워짐):", e);
    return NextResponse.json({
      cleared,
      file: { before, after: databaseFileBytes() },
      warning: "비우기는 됐지만 파일 공간은 돌려받지 못했습니다",
    });
  }
}
