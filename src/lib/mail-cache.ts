import type { InboxFetchResult } from "./providers/types";

/**
 * 프로세스 메모리 메일 캐시 (단일 컨테이너 가정).
 *
 * 정책 — **캐시는 만료돼도 버리지 않는다.**
 *   - TTL 안 : 그대로 반환 (IMAP 재조회 없음)
 *   - TTL 밖 : 낡은 값을 **즉시 반환**하고 뒤에서 조용히 갱신 (stale-while-revalidate)
 *   - 강제 새로고침(force=1) : 새 결과를 기다렸다가 반환
 *
 * 덕분에 TTL 이 지난 첫 요청이 IMAP 응답을 기다리며 멈추거나, 조회 실패로
 * 박스가 빈 채로 그려지는 일이 없다.
 */
export interface MailPayload {
  inboxes: InboxFetchResult[];
  fetchedAt: number;
}

let cached: MailPayload | null = null;
/** 진행 중인 갱신 — 동시에 여러 번 IMAP 을 두드리지 않도록 단일화. */
let inflight: Promise<MailPayload> | null = null;

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

/**
 * 조회 실패한 박스는 **직전 성공값을 살려 둔다.**
 * 일시적인 IMAP 오류로 이미 보여주던 메일이 사라지지 않게 하기 위함.
 * 오류 자체는 그대로 실어 보내 UI 가 알릴 수 있게 한다.
 */
export function mergeKeepingLastGood(
  prev: MailPayload | null,
  next: MailPayload,
): MailPayload {
  if (!prev) return next;

  const prevById = new Map(prev.inboxes.map((i) => [i.account.id, i]));
  const inboxes = next.inboxes.map((incoming) => {
    if (!incoming.error) return incoming;
    const old = prevById.get(incoming.account.id);
    if (!old || old.messages.length === 0) return incoming;
    return {
      ...incoming,
      messages: old.messages,
      unreadCount: old.unreadCount,
      // error 는 유지 — 화면에 "마지막으로 가져온 내용" 임을 알린다
    };
  });

  return { inboxes, fetchedAt: next.fetchedAt };
}

/**
 * 캐시 갱신. 이미 갱신이 돌고 있으면 그 결과를 함께 기다린다(single-flight).
 * 실패해도 기존 캐시는 남겨둔다.
 */
export function refreshMailCache(
  fetcher: () => Promise<MailPayload>,
): Promise<MailPayload> {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const fresh = await fetcher();
      const merged = mergeKeepingLastGood(cached, fresh);
      cached = merged;
      return merged;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** 백그라운드 갱신 — 호출자는 기다리지 않는다. */
export function revalidateInBackground(
  fetcher: () => Promise<MailPayload>,
): void {
  void refreshMailCache(fetcher).catch((err) => {
    console.warn("[mail] 백그라운드 갱신 실패 (캐시 유지):", err);
  });
}
