import { apiPath } from "./api-path";

/**
 * 메일 한 통의 **조각**을 가리키는 주소.
 *
 * 두 갈래로 나눠 둔 이유는 응답 정책이 다르기 때문이다 —
 *  - inline: 화면에 그리려고 부른다. 정말 그림인지 확인하고, 알아낸 타입으로
 *    내보내고, 브라우저가 캐시하게 둔다.
 *  - attachment: 디스크로 내려보내려고 부른다. 타입을 믿지 않고 통째로
 *    `application/octet-stream` 으로 내보내며 캐시하지 않는다.
 *
 * `apiPath()` 를 쓴다 — 이 주소들은 서버가 만들지만 **브라우저가 읽는 값**이고,
 * 하위 경로 배포에서는 접두어가 붙어야 한다.
 */

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

/** 본문의 `cid:` 가 가리키는 인라인 그림. */
export function inlineImagePath(
  accountId: number,
  messageId: string,
  partId: string,
): string {
  return apiPath(
    `/api/mail/${accountId}/${encodeURIComponent(messageId)}/inline/${encodeId(partId)}`,
  );
}

/** 첨부 내려받기. 화면이 목록의 `id` 를 그대로 끼워 만든다. */
export function attachmentPath(
  accountId: number,
  messageId: string,
  partId: string,
): string {
  return apiPath(
    `/api/mail/${accountId}/${encodeURIComponent(messageId)}/attachment/${encodeId(partId)}`,
  );
}
