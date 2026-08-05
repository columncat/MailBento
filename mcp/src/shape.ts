import { detectInjection } from "./injection.js";

/**
 * 응답 다듬기.
 *
 * 메일 목록은 계정마다 수십 통이 딸려 오고, 본문은 HTML 까지 실린다. 그대로
 * 도구 결과로 흘리면 한 번 조회에 대화가 가득 찬다. 여기서 필요한 것만 남기고,
 * 본문은 텍스트를 우선 쓰되 길이를 제한한다.
 */

export interface MailAddress {
  name: string | null;
  email: string;
}

export interface MailMessage {
  id: string;
  subject: string;
  from: MailAddress;
  receivedAt: number;
  snippet: string | null;
  unread: boolean;
  mark?: string | null;
  archived?: boolean;
}

export interface MailMessageDetail extends MailMessage {
  to: MailAddress[];
  cc: MailAddress[];
  html: string | null;
  text: string | null;
}

export interface Inbox {
  account: {
    id: number;
    provider: string;
    displayName: string;
    email: string;
    query?: string | null;
  };
  messages: MailMessage[];
  unreadCount: number | null;
  error?: string | null;
}

export interface MailResponse {
  inboxes: Inbox[];
  fetchedAt?: number;
  cached?: boolean;
  stale?: boolean;
}

export interface Account {
  id: number;
  provider: string;
  displayName: string;
  email: string;
  query: string | null;
  position: number;
}

export interface ArchivedSummary {
  id: number;
  subject: string;
  fromName: string | null;
  fromEmail: string;
  receivedAt: number;
  archivedAt: number;
  read: boolean;
  mark: string | null;
  sourceLabel: string;
  sourceAccountId: number | null;
  sourceMessageId: string;
}

/** 본문 기본 상한. 메일 하나가 대화를 다 먹지 않게. */
export const DEFAULT_BODY_LIMIT = 4000;

/**
 * 주입 흔적이 있으면 값을 지우고 표지만 남긴다.
 *
 * 앱의 자동 수집에서 이미 한 번 거르지만, 에이전트가 도구로 직접 목록을 부르는
 * 길도 있다. 그쪽으로 들어오는 것도 같은 규칙으로 막는다 — 한 곳만 막아 두면
 * 다른 문으로 들어온다.
 */
function guard(value: string | null, field: string): string | null {
  if (!value) return value;
  const hit = detectInjection([{ field, value }]);
  if (!hit) return value;
  return `[차단됨 — ${hit.marker} 가 발견되어 내용을 감췄습니다]`;
}

export function clip(s: string | null, limit: number): string | null {
  if (s === null) return null;
  if (limit <= 0 || s.length <= limit) return s;
  return `${s.slice(0, limit)}\n… (총 ${s.length}자, bodyLimit 를 올리면 더 받습니다)`;
}

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

const who = (a: MailAddress) => (a.name ? `${a.name} <${a.email}>` : a.email);

export function shapeMessage(m: MailMessage) {
  return compact({
    id: m.id,
    subject: guard(m.subject, "제목") || "(제목 없음)",
    from: guard(who(m.from), "보낸이"),
    receivedAt: m.receivedAt,
    snippet: guard(m.snippet, "미리보기"),
    unread: m.unread,
    mark: m.mark ?? null,
    archived: m.archived ?? false,
  });
}

export function shapeDetail(d: MailMessageDetail, bodyLimit: number) {
  // HTML 은 태그가 토큰을 다 먹는다. 텍스트가 있으면 그걸 쓰고, 없을 때만
  // HTML 을 성의 있게 벗겨 낸다.
  const body =
    d.text && d.text.trim()
      ? d.text
      : d.html
        ? stripHtml(d.html)
        : null;
  return compact({
    id: d.id,
    subject: guard(d.subject, "제목") || "(제목 없음)",
    from: guard(who(d.from), "보낸이"),
    to: d.to?.map(who) ?? [],
    cc: d.cc?.map(who) ?? [],
    receivedAt: d.receivedAt,
    unread: d.unread,
    mark: d.mark ?? null,
    // 본문은 감추지 않는다. 사용자가 버튼으로 허락하고 읽는 자리이고, 감추면
    // 읽는 의미가 없다. 대신 주입 흔적이 있으면 그 사실을 함께 알린다.
    body: clip(body, bodyLimit),
    injectionSuspected: body ? detectInjection([{ field: "본문", value: body }])?.marker ?? null : null,
    bodyFormat: d.text && d.text.trim() ? "text" : d.html ? "html→text" : "none",
  });
}

/** 아주 단순한 태그 제거. 읽을 수 있게 만드는 정도이지 렌더링이 아니다. */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function shapeArchived(a: ArchivedSummary) {
  return compact({
    id: a.id,
    subject: guard(a.subject, "제목") || "(제목 없음)",
    from: a.fromName ? `${a.fromName} <${a.fromEmail}>` : a.fromEmail,
    receivedAt: a.receivedAt,
    archivedAt: a.archivedAt,
    read: a.read,
    mark: a.mark,
    source: a.sourceLabel,
    // null 이면 원본 메일함이 지워진 사본이다. 사본 자체는 그대로 남는다.
    sourceAccountId: a.sourceAccountId,
    sourceMessageId: a.sourceMessageId,
  });
}

/** 메일함을 id·이름·주소 중 무엇으로든 고른다. */
export function resolveInbox(res: MailResponse, ref: string): Inbox {
  const asNum = Number(ref);
  if (Number.isInteger(asNum)) {
    const byId = res.inboxes.find((i) => i.account.id === asNum);
    if (byId) return byId;
  }
  const lower = ref.trim().toLowerCase();
  const hits = res.inboxes.filter(
    (i) =>
      i.account.displayName.toLowerCase() === lower ||
      i.account.email.toLowerCase() === lower,
  );
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new Error(
      `"${ref}" 에 맞는 메일함이 ${hits.length}개 있습니다. id 로 지정하세요: ${hits
        .map((i) => i.account.id)
        .join(", ")}`,
    );
  }
  throw new Error(
    `"${ref}" 에 해당하는 메일함이 없습니다. 있는 것: ${
      res.inboxes
        .map((i) => `${i.account.displayName}(${i.account.id})`)
        .join(", ") || "(없음)"
    }`,
  );
}
