import type { InboxFetchResult } from "./providers/types";

/**
 * 프로세스 메모리 메일 캐시 (단일 컨테이너 가정).
 * TTL 안에서는 IMAP 재조회 없이 이 값을 반환 → 서버 부하/연결 수 감소.
 */
export interface MailPayload {
  inboxes: InboxFetchResult[];
  fetchedAt: number;
}

let cached: MailPayload | null = null;

export function getMailCache(): MailPayload | null {
  return cached;
}

export function setMailCache(payload: MailPayload): void {
  cached = payload;
}

/** 계정/설정 변경 시 즉시 무효화. */
export function invalidateMailCache(): void {
  cached = null;
}
