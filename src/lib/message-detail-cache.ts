import type { MailMessageDetail } from "./providers/types";

/**
 * 방금 열어 본 메일 본문의 짧은 기억.
 *
 * 모달에서 읽은 메일을 곧바로 보관하는 것이 지배적인 흐름인데, 보관할 때
 * provider.fetchMessage 를 다시 부르면 IMAP 연결을 새로 열고 RFC822 원문을
 * 통째로 다시 받아 재파싱한다. 같은 자격증명의 뷰들이 연결 하나를 나눠 쓰도록
 * 묶어 둔 취지에도 어긋난다.
 *
 * 잃어버려도 IMAP 에서 다시 받아 오면 되므로 정합성에는 영향이 없다.
 * 단일 컨테이너를 전제한다 — mail-cache 와 같은 전제다.
 */
const MAX_ENTRIES = 10;
/** 이보다 큰 본문은 담지 않는다 — 프로세스 메모리 상한을 손으로 못박는다. */
const MAX_BYTES = 1_000_000;

const cache = new Map<string, MailMessageDetail>();

const key = (accountId: number, messageId: string) => `${accountId}:${messageId}`;

export function rememberDetail(
  accountId: number,
  messageId: string,
  detail: MailMessageDetail,
): void {
  const bytes =
    Buffer.byteLength(detail.html ?? "") + Buffer.byteLength(detail.text ?? "");
  if (bytes > MAX_BYTES) return;

  const k = key(accountId, messageId);
  // 다시 넣어 삽입순을 최신으로 올린다 (Map 은 삽입순을 지키므로 간이 LRU)
  cache.delete(k);
  cache.set(k, detail);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function peekDetail(
  accountId: number,
  messageId: string,
): MailMessageDetail | null {
  return cache.get(key(accountId, messageId)) ?? null;
}
