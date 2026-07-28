import { asc, desc, eq } from "drizzle-orm";

import { db, schema } from "./db";
import type { Account, MessageMark } from "./db/schema";
import { getFlag } from "./message-flags";
import type { MailAddress, MailMessageDetail } from "./providers/types";

const A = schema.archivedMessages;

/**
 * 보관 본문 상한.
 *
 * 본문은 파일이 아니라 SQLite TEXT 에 그대로 넣는다. 이 앱에는 업로드 디렉터리
 * 개념이 없고 컨테이너도 data 볼륨 하나만 마운트하므로, 파일 저장소를 새로
 * 만들면 경로 설정·생성·경로탈출 검사·고아 파일 정리가 통째로 딸려온다.
 *
 * sanitize 단계에서 <style> 블록이 내용째 사라지므로 마케팅 메일의 가장 큰
 * 부피원은 이미 빠진 상태고, 남는 위험은 data: 로 박아 넣은 인라인 이미지뿐이다.
 */
const MAX_HTML_BYTES = 2_000_000;
const MAX_TEXT_BYTES = 500_000;

export interface ArchivedSummary {
  id: number;
  sourceAccountId: number | null;
  sourceLabel: string;
  sourceEmail: string;
  sourceIconUrl: string | null;
  sourceMessageId: string;
  subject: string;
  fromName: string | null;
  fromEmail: string;
  /** unix ms. */
  receivedAt: number;
  archivedAt: number;
  read: boolean;
  mark: MessageMark | null;
  position: number;
}

export interface ArchivedDetail extends ArchivedSummary {
  to: MailAddress[];
  cc: MailAddress[];
  snippet: string | null;
  html: string | null;
  text: string | null;
  truncated: boolean;
}

/** 손상된 JSON 은 빈 배열로 — 위젯 저장소와 같은 폴백 관례. */
function parseAddrs(json: string): MailAddress[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as MailAddress[]) : [];
  } catch {
    return [];
  }
}

/** 상한을 넘으면 data: 인라인 이미지를 먼저 버리고, 그래도 크면 자른다. */
function capHtml(html: string | null): { html: string | null; cut: boolean } {
  if (!html || Buffer.byteLength(html) <= MAX_HTML_BYTES) {
    return { html, cut: false };
  }
  const stripped = html.replace(
    /src="data:[^"]*"/gi,
    'src="" data-archived-dropped="1"',
  );
  if (Buffer.byteLength(stripped) <= MAX_HTML_BYTES) {
    return { html: stripped, cut: true };
  }
  // 이미 sanitize 를 통과한 값이라 중간에서 잘려도 브라우저 파서가 태그를 닫는다
  return { html: stripped.slice(0, MAX_HTML_BYTES), cut: true };
}

function capText(text: string | null): { text: string | null; cut: boolean } {
  if (!text || Buffer.byteLength(text) <= MAX_TEXT_BYTES) {
    return { text, cut: false };
  }
  return { text: text.slice(0, MAX_TEXT_BYTES), cut: true };
}

type SummaryRow = {
  id: number;
  sourceAccountId: number | null;
  sourceLabel: string;
  sourceEmail: string;
  sourceIconUrl: string | null;
  sourceMessageId: string;
  subject: string;
  fromName: string | null;
  fromEmail: string;
  receivedAt: number;
  archivedAt: Date;
  read: number;
  mark: MessageMark | null;
  position: number;
};

function toSummary(r: SummaryRow): ArchivedSummary {
  return {
    ...r,
    archivedAt: r.archivedAt.getTime(),
    read: r.read === 1,
    mark: r.mark ?? null,
  };
}

/**
 * 목록에는 본문이 필요 없다.
 *
 * 대시보드가 그려질 때마다 도는 경로라, 수 MB 짜리 html 을 매번 끌어오지 않도록
 * 컬럼을 골라 받는다. 컬럼을 손으로 나열하지 않는 관례의 의도된 예외다.
 */
const SUMMARY_COLUMNS = {
  id: A.id,
  sourceAccountId: A.sourceAccountId,
  sourceLabel: A.sourceLabel,
  sourceEmail: A.sourceEmail,
  sourceIconUrl: A.sourceIconUrl,
  sourceMessageId: A.sourceMessageId,
  subject: A.subject,
  fromName: A.fromName,
  fromEmail: A.fromEmail,
  receivedAt: A.receivedAt,
  archivedAt: A.archivedAt,
  read: A.read,
  mark: A.mark,
  position: A.position,
} as const;

export function listArchived(): ArchivedSummary[] {
  return db
    .select(SUMMARY_COLUMNS)
    .from(A)
    .orderBy(asc(A.position), desc(A.archivedAt))
    .all()
    .map(toSummary);
}

export function getArchived(id: number): ArchivedDetail | null {
  const r = db.select().from(A).where(eq(A.id, id)).get();
  if (!r) return null;
  return {
    ...toSummary(r),
    to: parseAddrs(r.toJson),
    cc: parseAddrs(r.ccJson),
    snippet: r.snippet,
    html: r.html,
    text: r.text,
    truncated: r.truncated === 1,
  };
}

/**
 * 보관본을 라이브 메일과 같은 모양으로.
 *
 * 열람 모달이 두 가지 모양을 알 필요가 없게 서버에서 맞춰 준다 — 보관본은
 * fromName/fromEmail 로 납작하게 저장하지만 화면은 from.{name,email} 을 읽는다.
 */
export function toMailDetail(d: ArchivedDetail): MailMessageDetail {
  return {
    id: d.sourceMessageId,
    subject: d.subject,
    from: { name: d.fromName, email: d.fromEmail },
    receivedAt: d.receivedAt,
    snippet: d.snippet,
    unread: !d.read,
    mark: d.mark,
    to: d.to,
    cc: d.cc,
    html: d.html,
    text: d.text,
  };
}

/** `${accountId}:${messageId}` → 보관함 행 id. 메일 목록에 보관 여부를 얹을 때 쓴다. */
export function archiveIdsBySource(): Map<string, number> {
  const rows = db
    .select({
      id: A.id,
      sourceAccountId: A.sourceAccountId,
      sourceMessageId: A.sourceMessageId,
    })
    .from(A)
    .all();
  const out = new Map<string, number>();
  for (const r of rows) {
    // 계정이 사라진 사본은 라이브 목록과 이어 붙일 수 없다
    if (r.sourceAccountId == null) continue;
    out.set(`${r.sourceAccountId}:${r.sourceMessageId}`, r.id);
  }
  return out;
}

export function archiveMessage(
  account: Account,
  detail: MailMessageDetail,
): ArchivedSummary {
  const { html, cut: htmlCut } = capHtml(detail.html);
  const { text, cut: textCut } = capText(detail.text);
  // 라이브 표식을 한 번 복사해 스냅샷으로 둔다. 이후로는 따로 산다 —
  // message_flags 는 계정과 함께 사라지므로 계속 기댈 수 없다.
  const flag = getFlag(account.id, detail.id);

  // 새 항목은 맨 앞에. position 을 전부 0 으로 두면 정렬이 불안정해진다.
  const minPos = db
    .select({ position: A.position })
    .from(A)
    .all()
    .reduce((m, r) => Math.min(m, r.position), 0);

  const values = {
    sourceAccountId: account.id,
    sourceLabel: account.displayName,
    sourceEmail: account.displayEmail ?? account.email,
    sourceIconUrl: account.iconUrl,
    sourceMessageId: detail.id,
    subject: detail.subject,
    fromName: detail.from.name,
    fromEmail: detail.from.email,
    toJson: JSON.stringify(detail.to),
    ccJson: JSON.stringify(detail.cc),
    receivedAt: detail.receivedAt,
    snippet: detail.snippet,
    html,
    text,
    truncated: htmlCut || textCut ? 1 : 0,
    read: flag.read ? 1 : 0,
    mark: flag.mark,
  };

  db.insert(A)
    .values({ ...values, position: minPos - 1 })
    .onConflictDoUpdate({
      target: [A.sourceAccountId, A.sourceMessageId],
      // 다시 보관하면 본문과 메타만 덮고 position 과 archivedAt 은 그대로 둔다.
      // 사용자가 잡아 둔 순서를 흔들지 않기 위해서다.
      set: values,
    })
    .run();

  const row = db
    .select(SUMMARY_COLUMNS)
    .from(A)
    .where(eq(A.sourceMessageId, detail.id))
    .orderBy(desc(A.archivedAt))
    .get();
  if (!row) throw new Error("보관에 실패했습니다");
  return toSummary(row);
}

export function setArchivedFlag(
  id: number,
  patch: { read?: boolean; mark?: MessageMark | null },
): ArchivedSummary | null {
  const set: Record<string, unknown> = {};
  if (patch.read !== undefined) set.read = patch.read ? 1 : 0;
  if (patch.mark !== undefined) set.mark = patch.mark;
  if (Object.keys(set).length > 0) {
    db.update(A).set(set).where(eq(A.id, id)).run();
  }
  const row = db.select(SUMMARY_COLUMNS).from(A).where(eq(A.id, id)).get();
  return row ? toSummary(row) : null;
}

export function deleteArchived(id: number): void {
  db.delete(A).where(eq(A.id, id)).run();
}

export function reorderArchived(orderedIds: number[]): void {
  // 개별 UPDATE 를 트랜잭션으로 감싼다. 감싸지 않으면 중간에 끊겼을 때
  // 순서가 반쯤 섞인 채로 남는다.
  db.transaction((tx) => {
    orderedIds.forEach((id, i) => {
      tx.update(A).set({ position: i }).where(eq(A.id, id)).run();
    });
  });
}

/** 백업용 — 본문까지 통째로. */
export function exportArchived() {
  return db.select().from(A).orderBy(asc(A.position)).all();
}

/**
 * 백업에서 되살린다.
 *
 * sourceAccountId 는 버리고 null 로 넣는다. 계정 id 는 autoincrement 라 다른
 * 인스턴스에서는 전혀 다른 계정을 가리키게 된다 — 잘못 이어 붙이느니 출처
 * 이름만 남기는 편이 정직하다.
 */
export function importArchived(rows: unknown[]): number {
  let count = 0;
  db.transaction((tx) => {
    tx.delete(A).run();
    rows.forEach((raw, i) => {
      const r = raw as Record<string, unknown>;
      if (typeof r?.subject !== "string" || typeof r?.sourceMessageId !== "string") {
        return;
      }
      tx.insert(A)
        .values({
          sourceAccountId: null,
          sourceLabel: String(r.sourceLabel ?? "(알 수 없음)"),
          sourceEmail: String(r.sourceEmail ?? ""),
          sourceIconUrl: (r.sourceIconUrl as string | null) ?? null,
          sourceMessageId: r.sourceMessageId,
          subject: r.subject,
          fromName: (r.fromName as string | null) ?? null,
          fromEmail: String(r.fromEmail ?? ""),
          toJson: String(r.toJson ?? "[]"),
          ccJson: String(r.ccJson ?? "[]"),
          receivedAt: Number(r.receivedAt) || Date.now(),
          snippet: (r.snippet as string | null) ?? null,
          html: (r.html as string | null) ?? null,
          text: (r.text as string | null) ?? null,
          truncated: Number(r.truncated) === 1 ? 1 : 0,
          read: Number(r.read) === 1 ? 1 : 0,
          mark: (r.mark as MessageMark | null) ?? null,
          position: Number(r.position) || i,
        })
        .run();
      count++;
    });
  });
  return count;
}
