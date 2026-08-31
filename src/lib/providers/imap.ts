import { ImapFlow, type MessageStructureObject } from "imapflow";
import { simpleParser, type Attachment, type AddressObject } from "mailparser";

import { decrypt } from "../crypto";
import type { Account } from "../db/schema";
import { sniffImageType } from "../image-bytes";
import { imageProxyPath } from "../mail-image-proxy";
import { inlineImagePath } from "../mail-part-url";
import {
  plainTextToSafeHtml,
  sanitizeEmailHtml,
  type EmailImagePolicy,
  type InlineImageMode,
} from "../sanitize";
import type {
  FetchMessageOptions,
  MailAddress,
  MailAttachment,
  MailMessage,
  MailMessageDetail,
  MailProvider,
} from "./types";

export interface ImapConnectOptions {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export function makeImapClient(opts: ImapConnectOptions): ImapFlow {
  return new ImapFlow({
    host: opts.host,
    port: opts.port,
    secure: opts.port === 993,
    auth: { user: opts.user, pass: opts.pass },
    logger: false,
    // 무한 hang 방지 — 하나의 계정이 전체 /api/mail 을 막지 않도록
    connectionTimeout: 15000, // TCP+TLS 연결
    greetingTimeout: 10000, // 서버 인사
    socketTimeout: 30000, // 유휴 소켓
  });
}

export async function withImapConnection<T>(
  opts: ImapConnectOptions,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = makeImapClient(opts);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function testImapConnection(
  opts: ImapConnectOptions,
): Promise<void> {
  await withImapConnection(opts, async () => {});
}

// ─────────────────────────────────────────────────────────────
//   IMAP "뷰" 쿼리 파서
//   query 필드를 폴더 선택 + 서버사이드 SEARCH 로 해석.
//   토큰(공백 구분, AND): folder:/from:/to:/cc:/subject:(subj:)/
//   body:(text:)/since:YYYY-MM-DD/before:YYYY-MM-DD/unseen/seen,
//   key 없는 단어는 본문(text) 검색. 공백 포함 값은 "..." 로.
// ─────────────────────────────────────────────────────────────

export interface ImapSearchCriteria {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  since?: Date;
  before?: Date;
  seen?: boolean;
}

export interface ImapView {
  folder: string;
  criteria: ImapSearchCriteria | null; // null = 검색 없음 (폴더 최신 N개)
}

function tokenizeQuery(q: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) tokens.push(m[1] ?? m[2]);
  return tokens;
}

export function parseImapView(query?: string | null): ImapView {
  let folder = "INBOX";
  const crit: ImapSearchCriteria = {};
  const bodyParts: string[] = [];
  let hasFilter = false;

  if (query && query.trim()) {
    for (const raw of tokenizeQuery(query.trim())) {
      const idx = raw.indexOf(":");
      const key = idx > 0 ? raw.slice(0, idx).toLowerCase() : "";
      const val = idx > 0 ? raw.slice(idx + 1) : raw;
      switch (key) {
        case "folder":
        case "mailbox":
          if (val) folder = val;
          break;
        case "from":
          crit.from = val;
          hasFilter = true;
          break;
        case "to":
          crit.to = val;
          hasFilter = true;
          break;
        case "cc":
          crit.cc = val;
          hasFilter = true;
          break;
        case "subject":
        case "subj":
          crit.subject = val;
          hasFilter = true;
          break;
        case "body":
        case "text":
          bodyParts.push(val);
          hasFilter = true;
          break;
        case "since": {
          const d = new Date(val);
          if (!Number.isNaN(d.getTime())) {
            crit.since = d;
            hasFilter = true;
          }
          break;
        }
        case "before": {
          const d = new Date(val);
          if (!Number.isNaN(d.getTime())) {
            crit.before = d;
            hasFilter = true;
          }
          break;
        }
        default: {
          const low = raw.toLowerCase();
          if (low === "unseen" || low === "unread") {
            crit.seen = false;
            hasFilter = true;
          } else if (low === "seen" || low === "read") {
            crit.seen = true;
            hasFilter = true;
          } else {
            bodyParts.push(raw);
            hasFilter = true;
          }
        }
      }
    }
    if (bodyParts.length) crit.body = bodyParts.join(" ");
  }

  return { folder, criteria: hasFilter ? crit : null };
}

export async function fetchInboxFromClient(
  client: ImapFlow,
  limit: number,
  query?: string | null,
): Promise<MailMessage[]> {
  const { folder, criteria } = parseImapView(query);
  const lock = await client.getMailboxLock(folder);
  try {
    let source: string;
    let byUid = false;

    if (criteria) {
      const uids = await client.search(criteria, { uid: true });
      if (!uids || uids.length === 0) return [];
      source = uids.slice(-limit).join(","); // 최신(높은 UID) limit개
      byUid = true;
    } else {
      const status = await client.status(folder, { messages: true });
      const total = status.messages ?? 0;
      if (total === 0) return [];
      const from = Math.max(1, total - limit + 1);
      source = `${from}:${total}`;
    }

    const messages: MailMessage[] = [];
    for await (const msg of client.fetch(
      source,
      { envelope: true, flags: true, uid: true, internalDate: true },
      byUid ? { uid: true } : undefined,
    )) {
      const envelope = msg.envelope;
      const fromAddr = envelope?.from?.[0];
      const email = fromAddr?.address ?? "";
      messages.push({
        id: String(msg.uid),
        subject: envelope?.subject ?? "(제목 없음)",
        from: { name: fromAddr?.name?.trim() || null, email },
        receivedAt: msg.internalDate
          ? new Date(msg.internalDate).getTime()
          : Date.now(),
        snippet: null,
        unread: !msg.flags?.has("\\Seen"),
      });
    }

    return messages.reverse();
  } finally {
    lock.release();
  }
}

export async function fetchUnreadCountFromClient(
  client: ImapFlow,
  query?: string | null,
): Promise<number | null> {
  const { folder, criteria } = parseImapView(query);
  // 검색 필터가 있으면 정확한 미읽음 수를 status 로 못 구함 → null (가져온 메시지에서 계산)
  if (criteria) return null;
  const status = await client.status(folder, { unseen: true });
  return status.unseen ?? null;
}

function parsedAddrToMailAddr(
  addr: AddressObject | AddressObject[] | undefined,
): MailAddress[] {
  if (!addr) return [];
  const list = Array.isArray(addr) ? addr : [addr];
  const result: MailAddress[] = [];
  for (const a of list) {
    for (const v of a.value ?? []) {
      result.push({
        name: v.name?.trim() || null,
        email: v.address ?? "",
      });
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
//   메일 한 통의 조각들 — 첨부 목록과 cid 지도
// ─────────────────────────────────────────────────────────────

/**
 * mailparser 가 실제로 채워 주는 `partId` 가 @types/mailparser 에는 없다
 * (mail-parser.js 의 경계 카운터가 만든다). 있으면 쓰고 없으면 없는 대로 —
 * 어차피 서버가 준 번호와 맞을 때만 믿는 값이다.
 */
type ParsedAttachment = Attachment & { partId?: string };

/** IMAP 이 말해 준 조각 하나. 파서가 본 것이 아니라 **서버가 말한** 구조다. */
interface PartNode {
  /** body part 번호. download() 에 그대로 넘긴다. */
  part: string;
  /** 소문자 MIME 타입. */
  type: string;
  /** 인코딩된 크기(서버 기준). base64 면 실제 파일보다 4/3 배 크다. */
  size: number | null;
  encoding: string | null;
  disposition: string | null;
  filename: string | null;
  /** Content-ID 에서 홑화살괄호를 벗긴 값. */
  cid: string | null;
}

/** 대소문자를 가리지 않고 매개변수 하나 꺼내기 (서버마다 표기가 다르다). */
function param(
  bag: { [k: string]: string } | undefined,
  name: string,
): string | null {
  if (!bag) return null;
  for (const [k, v] of Object.entries(bag)) {
    if (k.toLowerCase() === name) return v || null;
  }
  return null;
}

/**
 * bodyStructure 트리를 잎 조각들로 편다.
 *
 * `message/rfc822` 는 **한 덩이로 센다.** 안쪽까지 펴면 첨부된 메일의 본문·
 * 서명 조각이 목록에 흩어져, 사람이 받고 싶은 것(그 .eml 한 개)이 사라진다.
 */
function flattenStructure(
  node: MessageStructureObject,
  out: PartNode[] = [],
): PartNode[] {
  const type = (node.type ?? "").toLowerCase();
  if (type.startsWith("multipart/") && node.childNodes?.length) {
    for (const child of node.childNodes) flattenStructure(child, out);
    return out;
  }
  out.push({
    // 단일 파트 메일에서는 서버가 번호를 안 준다 — 그때의 번호는 "1" 이다.
    part: node.part ?? "1",
    type: type || "application/octet-stream",
    size: typeof node.size === "number" ? node.size : null,
    encoding: node.encoding?.toLowerCase() ?? null,
    disposition: node.disposition?.toLowerCase() ?? null,
    filename:
      param(node.dispositionParameters, "filename") ??
      param(node.parameters, "name"),
    cid: node.id ? node.id.replace(/^</, "").replace(/>$/, "") : null,
  });
  return out;
}

/**
 * 이 조각이 **본문**인가.
 *
 * 본문은 첨부 목록에 서면 안 된다. 기준은 "글이면서, 첨부라고 적혀 있지도 않고,
 * 이름도 없다" — 이름이 붙은 text/plain 은 사람이 붙인 메모 파일이라 첨부다.
 */
function isBodyPart(p: PartNode): boolean {
  if (p.type !== "text/plain" && p.type !== "text/html") return false;
  if (p.disposition === "attachment") return false;
  return !p.filename;
}

/** base64 는 3바이트를 4글자로 적는다. 서버가 준 것은 그 4글자 쪽 크기다. */
function decodedSize(p: PartNode): number | null {
  if (p.size === null) return null;
  return p.encoding === "base64" ? Math.round((p.size * 3) / 4) : p.size;
}

/**
 * 보관용으로 그림을 본문에 구울 때의 전체 예산.
 *
 * archive-server 의 MAX_HTML_BYTES(2MB)보다 낮게 잡아 둔다. 그쪽 상한을 넘기면
 * capHtml 이 `src="data:…"` 를 **전부** 날려서 작은 로고까지 함께 사라진다 —
 * 여기서 미리 멈추면 커다란 한 장만 빠지고 나머지는 산다.
 */
const EMBED_BUDGET_BYTES = 1_500_000;

export interface FetchMessageContext {
  /**
   * 조각 주소가 `/api/mail/{accountId}/{uid}/…` 라서 계정 id 가 필요하다.
   * 본문에 박히는 값이라 부르는 쪽이 반드시 넘겨야 한다.
   */
  accountId: number;
  /** 기본 "link" — 화면용. 보관할 때만 "embed". */
  inlineImages?: InlineImageMode;
}

export async function fetchMessageFromClient(
  client: ImapFlow,
  uid: number,
  folder = "INBOX",
  ctx: FetchMessageContext = { accountId: 0 },
): Promise<MailMessageDetail> {
  const lock = await client.getMailboxLock(folder);
  try {
    const result = await client.fetchOne(
      String(uid),
      {
        source: true,
        envelope: true,
        flags: true,
        internalDate: true,
        uid: true,
        /*
         * 파서가 매긴 partId 를 그대로 믿지 않으려고 함께 받는다.
         *
         * mailparser 의 partId 는 자기가 센 경계 번호이고, download() 에 넘길
         * 번호는 **IMAP 서버가 매기는** 것이다. 보통 같지만 message/rfc822
         * 중첩이나 단일 파트에서 어긋난다(imapflow 자신도 part "1" 을 따로
         * 다룬다). 원문을 이미 받는 요청에 한 필드를 얹는 값은 거의 0 이다.
         */
        bodyStructure: true,
      },
      { uid: true },
    );
    if (!result) {
      throw new Error(`메시지를 찾을 수 없습니다 (UID ${uid})`);
    }

    const source = result.source as Buffer;
    /*
     * `keepCidLinks: true` — 기본값(false)이면 mailparser 가 본문의 `cid:` 를
     * `data:<타입>;base64,…` 로 **먼저 갈아치운다.** 그러면 우리가 주소를
     * 바꿀 기회가 없고, 그림 한 장이 본문에 통째로 박혀 1MB 캐시 상한을 넘겨
     * 그 메일은 영영 캐시를 못 탄다(그 사실은 로그에도 안 남는다).
     *
     * `cid:` 를 남겨 두고 아래 정책이 갈래를 정한다 — 화면이면 우리 라우트로,
     * 보관이면 여기서 직접 data: 로 굽는다.
     */
    const parsed = await simpleParser(source, { keepCidLinks: true });

    const structure = result.bodyStructure
      ? flattenStructure(result.bodyStructure)
      : [];
    const attachmentsRaw: ParsedAttachment[] = parsed.attachments ?? [];

    /*
     * cid → 손잡이.
     *
     * IMAP 이 구조를 줬으면 그쪽 번호를 쓴다(서버가 매긴 값이라 download() 가
     * 확실히 알아듣는다). 안 줬으면 파서가 본 순서를 "i0" 같은 자리표로 쓰고,
     * 라우트가 원문을 다시 받아 그 번호째 조각을 꺼낸다.
     */
    const cidToId = new Map<string, string>();
    for (const part of structure) {
      if (part.cid && !cidToId.has(part.cid)) cidToId.set(part.cid, part.part);
    }
    attachmentsRaw.forEach((att, i) => {
      if (att.cid && !cidToId.has(att.cid)) cidToId.set(att.cid, `i${i}`);
    });

    const byCid = new Map<string, ParsedAttachment>();
    for (const att of attachmentsRaw) {
      if (att.cid && !byCid.has(att.cid)) byCid.set(att.cid, att);
    }
    /** 파서가 잰 **디코딩된** 크기·이름. 번호가 맞을 때만 쓴다. */
    const byPartId = new Map<string, ParsedAttachment>();
    for (const att of attachmentsRaw) {
      if (att.partId && !byPartId.has(att.partId)) byPartId.set(att.partId, att);
    }

    const mode: InlineImageMode = ctx.inlineImages ?? "link";
    let embedded = 0;

    const policy: EmailImagePolicy = {
      resolveCid(cid) {
        if (mode === "embed") {
          // 보관 사본은 스스로 서야 한다 — 원본이 IMAP 에서 사라진 뒤에도
          // 열리는 것이 보관함의 존재 이유다. 그래서 바이트를 몸에 굽는다.
          const att = byCid.get(cid);
          /*
           * **바이트를 보고 타입을 정한다.** `att.contentType` 은 발신자가
           * 적은 값이라, 그대로 믿으면 보관본에
           * `data:image/svg+xml;base64,…` 를 굽게 된다 — SVG 는 `<script>` 를
           * 품는 문서라 우리 오리진에서 열리는 순간 앱의 DOM 을 만진다.
           * 인라인·프록시 라우트는 이미 sniffImageType 으로 보는데 이 길만
           * 발신자 말을 믿고 있었다. 아는 래스터 그림만, 알아낸 타입으로.
           */
          if (!att?.content) return null;
          const sniffed = sniffImageType(att.content);
          if (!sniffed) return null;
          const b64 = att.content.toString("base64");
          // 예산을 넘으면 그 한 장만 버린다. 통째로 자르는 것보다 낫다 —
          // 작은 로고들은 살고 커다란 한 장만 사라진다.
          if (embedded + b64.length > EMBED_BUDGET_BYTES) return null;
          embedded += b64.length;
          return `data:${sniffed};base64,${b64}`;
        }
        const id = cidToId.get(cid);
        return id ? inlineImagePath(ctx.accountId, String(uid), id) : null;
      },
      proxyRemote(url) {
        return imageProxyPath(url);
      },
    };

    const fromList = parsedAddrToMailAddr(parsed.from);
    const from = fromList[0] ?? { name: null, email: "" };

    const htmlRaw =
      typeof parsed.html === "string" && parsed.html.length > 0
        ? parsed.html
        : null;
    const text = parsed.text ?? null;

    let html: string | null = null;
    let blockedTrackers = 0;
    let proxiedImages = 0;
    let usedCids = new Set<string>();
    if (htmlRaw) {
      const clean = sanitizeEmailHtml(htmlRaw, policy);
      html = clean.html;
      blockedTrackers = clean.blockedTrackers;
      proxiedImages = clean.proxiedImages;
      usedCids = clean.usedCids;
    } else if (text) {
      // 글자만 있는 메일에는 그림도 추적 픽셀도 없다.
      html = plainTextToSafeHtml(text);
    }

    return {
      id: String(uid),
      subject: parsed.subject ?? result.envelope?.subject ?? "(제목 없음)",
      from,
      receivedAt: result.internalDate
        ? new Date(result.internalDate).getTime()
        : Date.now(),
      snippet: null,
      unread: !result.flags?.has("\\Seen"),
      to: parsedAddrToMailAddr(parsed.to),
      cc: parsedAddrToMailAddr(parsed.cc),
      html,
      text,
      attachments: listAttachments(
        structure,
        attachmentsRaw,
        byPartId,
        usedCids,
      ),
      blockedTrackers,
      proxiedImages,
    };
  } finally {
    lock.release();
  }
}

/**
 * 화면에 세울 첨부 목록. **바이트는 담기지 않는다.**
 *
 * 본문이 `cid:` 로 쓰고 있는 조각은 뺀다 — 이미 화면에 그려져 있는 그림을
 * "내려받기" 로 한 번 더 세우면, 로고 조각 스무 개 사이에 정작 받아야 할
 * 파일이 묻힌다. mailparser 의 `related` 플래그가 아니라 **본문이 실제로 쓴
 * cid** 로 가른다: `Content-ID` 가 붙어 있어도 본문이 안 쓰면 화면 어디에도
 * 안 나오므로, 목록에 남겨야 사람이 그것에 닿을 수 있다.
 */
function listAttachments(
  structure: PartNode[],
  attachmentsRaw: ParsedAttachment[],
  byPartId: Map<string, ParsedAttachment>,
  usedCids: Set<string>,
): MailAttachment[] {
  if (structure.length > 0) {
    const out: MailAttachment[] = [];
    for (const part of structure) {
      if (isBodyPart(part)) continue;
      if (part.cid && usedCids.has(part.cid)) continue;
      // 번호가 맞을 때만 파서 값을 얹는다 — 파서는 디코딩된 크기를 알고,
      // 이름의 MIME 인코딩(=?UTF-8?B?…?=)도 이미 풀어 놓았다.
      const guess = byPartId.get(part.part);
      const matched =
        guess && guess.contentType?.toLowerCase() === part.type ? guess : null;
      out.push({
        id: part.part,
        filename: matched?.filename ?? part.filename ?? null,
        contentType: part.type,
        size: matched?.size ?? decodedSize(part),
      });
    }
    return out;
  }

  // 서버가 구조를 안 줬다 — 파서가 본 것으로만 세운다.
  return attachmentsRaw
    .map((att, i) => ({ att, id: `i${i}` }))
    .filter(({ att }) => !(att.cid && usedCids.has(att.cid)))
    .map(({ att, id }) => ({
      id,
      filename: att.filename ?? null,
      contentType: (att.contentType ?? "application/octet-stream").toLowerCase(),
      size: typeof att.size === "number" ? att.size : null,
    }));
}

// ─────────────────────────────────────────────────────────────
//   provider — basic auth (Naver / 임의 IMAP + app password)
// ─────────────────────────────────────────────────────────────

export function basicCredsFromAccount(account: Account): ImapConnectOptions {
  if (
    !account.imapHost ||
    !account.imapPort ||
    !account.imapUsername ||
    !account.imapPasswordEnc
  ) {
    throw new Error(
      "IMAP 자격 증명이 누락되었습니다. 계정을 다시 등록해주세요.",
    );
  }
  return {
    host: account.imapHost,
    port: account.imapPort,
    user: account.imapUsername,
    pass: decrypt(account.imapPasswordEnc),
  };
}

/** 같은 자격증명(host+port+user+pass) 이면 하나의 계정으로 묶는 키. */
function credKey(a: Account): string {
  return [a.imapHost, a.imapPort, a.imapUsername, a.imapPasswordEnc].join("|");
}

export interface AccountFetch {
  messages: MailMessage[];
  unreadCount: number | null;
  error: string | null;
}

/**
 * 여러 계정/뷰를 가져오되, **같은 IMAP 자격증명은 연결 1개를 공유**해서
 * 그 안에서 뷰별로 순차 조회한다. (같은 메일함의 여러 "뷰"가 각각 연결을
 * 열어 서버 동시 연결 제한에 걸려 "connection in required time" 나던 문제 해결.)
 */
export async function fetchInboxesGrouped(
  accounts: Account[],
  perBox: number,
): Promise<Map<number, AccountFetch>> {
  const groups = new Map<string, Account[]>();
  for (const a of accounts) {
    const key = credKey(a);
    const g = groups.get(key);
    if (g) g.push(a);
    else groups.set(key, [a]);
  }

  const out = new Map<number, AccountFetch>();

  await Promise.all(
    [...groups.values()].map(async (group) => {
      let creds: ImapConnectOptions;
      try {
        creds = basicCredsFromAccount(group[0]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "IMAP 설정 오류";
        for (const a of group)
          out.set(a.id, { messages: [], unreadCount: null, error: msg });
        return;
      }

      try {
        await withImapConnection(creds, async (client) => {
          for (const a of group) {
            try {
              const messages = await fetchInboxFromClient(
                client,
                perBox,
                a.query,
              );
              let uc = await fetchUnreadCountFromClient(client, a.query).catch(
                () => null,
              );
              if (uc === null) uc = messages.filter((m) => m.unread).length;
              out.set(a.id, { messages, unreadCount: uc, error: null });
            } catch (err) {
              out.set(a.id, {
                messages: [],
                unreadCount: null,
                error: err instanceof Error ? err.message : "가져오기 실패",
              });
            }
          }
        });
      } catch (err) {
        // 연결 자체 실패 → 그룹 전체 에러 (아직 안 채워진 뷰만)
        const msg = err instanceof Error ? err.message : "연결 실패";
        for (const a of group)
          if (!out.has(a.id))
            out.set(a.id, { messages: [], unreadCount: null, error: msg });
      }
    }),
  );

  return out;
}

export const imapProvider: MailProvider = {
  async fetchInbox(account: Account, limit: number): Promise<MailMessage[]> {
    return withImapConnection(basicCredsFromAccount(account), (c) =>
      fetchInboxFromClient(c, limit, account.query),
    );
  },
  async fetchUnreadCount(account: Account): Promise<number | null> {
    return withImapConnection(basicCredsFromAccount(account), (c) =>
      fetchUnreadCountFromClient(c, account.query),
    );
  },
  async fetchMessage(
    account: Account,
    messageId: string,
    options?: FetchMessageOptions,
  ): Promise<MailMessageDetail> {
    const uid = parseInt(messageId, 10);
    if (!Number.isFinite(uid)) throw new Error("유효하지 않은 message ID");
    const { folder } = parseImapView(account.query);
    return withImapConnection(basicCredsFromAccount(account), (c) =>
      fetchMessageFromClient(c, uid, folder, {
        accountId: account.id,
        inlineImages: options?.inlineImages ?? "link",
      }),
    );
  },
};
