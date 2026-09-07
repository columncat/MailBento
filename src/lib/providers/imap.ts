import type { ImapFlow, MessageStructureObject } from "imapflow";
import {
  simpleParser,
  type AddressObject,
  type Attachment,
  type ParsedMail,
} from "mailparser";

import type { Account } from "../db/schema";
import {
  basicCredsFromAccount,
  withImapConnection,
  type ImapConnectOptions,
} from "../imap-client";
import { borrowImapConnection } from "../imap-pool";
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

/*
 * 연결을 여는 일 자체는 `../imap-client` 로 내려갔다 (연결 풀이 그것만
 * 필요로 하는데, 여기서 가져가면 두 모듈이 서로를 무는 순환이 된다).
 * 부르던 곳들이 계속 여기서 가져다 쓰므로 그대로 다시 내보낸다.
 */
export {
  basicCredsFromAccount,
  makeImapClient,
  testImapConnection,
  withImapConnection,
  type ImapConnectOptions,
} from "../imap-client";

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
  /**
   * Content-Type 의 매개변수들 (`charset`, `format`, `name` …).
   *
   * 조각만 받는 길에서 **그 조각의 MIME 헤더를 되짚어 세울 때** 쓴다. 서버가
   * `BODY[n.MIME]` 를 안 주면 이것으로 짓는데, 여기에 `charset` 이 빠지면
   * euc-kr 로 적힌 한글 본문이 통째로 깨진다.
   */
  parameters: { [k: string]: string } | undefined;
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
  out.push(toPartNode(node));
  return out;
}

/** 서버가 말한 조각 하나를 우리 모양으로. */
function toPartNode(node: MessageStructureObject): PartNode {
  const type = (node.type ?? "").toLowerCase();
  return {
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
    parameters: node.parameters,
  };
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

// ─────────────────────────────────────────────────────────────
//   조각만 받아도 되는가 — mailparser 의 눈으로 다시 보기
// ─────────────────────────────────────────────────────────────

/*
 * ── 왜 `isBodyPart` 로는 못 고르는가 ──
 *
 * `isBodyPart` 는 **첨부 목록에 세울 것인가**를 가르는 잣대다. 조각만 받는
 * 길이 물어야 하는 것은 다른 질문이다 — **mailparser 가 원문을 통째로 봤다면
 * 무엇을 본문에 넣었을까.** 이 둘을 같은 함수에 물었더니 글이 사라졌다.
 *
 * 실측으로 드러난 어긋남(A/B rig, uid 217~221):
 *
 *   mixed[ alternative[plain,html], text/plain 꼬리말, 3MB pdf ]
 *     → 꼬리말은 alternative **밖**이라 mailparser 가 textToHtml 해서 html 에
 *       **이어 붙인다**. 우리는 그것을 text 에만 담았다. 화면이 그리는 것은
 *       html 이므로 구독취소 줄이 통째로 사라졌다.
 *   mixed[html, plain, 첨부] · mixed[plain, html, 첨부]
 *     → html·text 양쪽이 갈렸다.
 *   multipart/report[ text/plain, message/delivery-status, … ]
 *     → mailparser 는 delivery-status 도 **글자 본문으로 센다**(textTypes).
 *       우리는 첨부로 보아 반송 사유가 사라졌다.
 *   mixed[ plain, message/rfc822(inline), 첨부 ]
 *     → mailparser 는 안쪽 메일까지 펴서 본문에 넣는다. 우리는 한 덩이로 세어
 *       안쪽 글이 사라졌다.
 *
 * 그래서 아래는 mailparser 의 규칙을 **그대로 옮긴다**. 옮긴 자리는
 * `mail-parser.js` 의 `createNode`(disposition 정하기) · `getTextContent`
 * (본문을 html/text 에 넣는 규칙) · `textTypes` 다.
 */

/**
 * mailparser 가 **본문 글자로 세는** 타입들 (`mail-parser.js` 의 `textTypes`).
 *
 * `message/delivery-status` 가 여기 든다 — 반송 메일의 사유가 본문에 섞여
 * 나오는 이유다. 우리가 이 목록을 좁게 잡으면 그만큼 글이 사라진다.
 */
const PARSER_TEXT_TYPES = new Set([
  "text/plain",
  "text/html",
  "message/delivery-status",
]);

/**
 * mailparser 가 이 조각의 disposition 을 무엇으로 볼까.
 *
 * **파일 이름은 보지 않는다.** `Content-Type: text/plain; name="notes.txt"` 도,
 * `Content-Disposition: inline; filename="sig.txt"` 도 파서에게는 본문이다.
 * (`isBodyPart` 는 이름을 보는데, 그것은 첨부 목록을 위한 다른 잣대다.)
 */
function parserDisposition(p: PartNode): "inline" | "attachment" {
  if (p.disposition === "attachment" || p.disposition === "inline") {
    return p.disposition;
  }
  if (p.disposition) return "attachment"; // 모르는 값은 첨부로 친다
  return PARSER_TEXT_TYPES.has(p.type) ? "inline" : "attachment";
}

interface BodyPlan {
  /** 받아야 할 본문 조각들. 트리 순서 — mailparser 가 도는 순서와 같다. */
  parts: PartNode[];
  /** 이 조각들만 받아도 원문을 통째로 판 것과 **같은 결과**가 나오나. */
  faithful: boolean;
  /** 아니라면 무엇 때문인가. 로그에 남는다. */
  reason: string;
}

/**
 * 조각만 받아도 되는지 판단하고, 받을 조각을 고른다.
 *
 * ── 언제 같은 결과가 나오는가 ──
 * `getTextContent` 는 조각 하나하나를 이렇게 나눈다:
 *
 *   text/plain (또는 delivery-status)
 *     → text 에 넣는다. **alternative 밖이고 html 이 하나라도 있으면**
 *       textToHtml 한 것을 html 에도 넣는다.
 *   text/html
 *     → html 에 넣는다. **alternative 밖이고 plain 이 하나라도 있으면**
 *       htmlToText 한 것을 text 에도 넣는다.
 *
 * 우리는 조각을 따로 파서 html 은 html 끼리, text 는 text 끼리 잇는다. 그러니
 * 위의 **가로지르는 두 줄이 한 번도 안 걸릴 때만** 두 길의 결과가 같다.
 * 그 조건이 아래 `faithful` 이다. 흔한 모양은 대부분 여기 든다:
 *
 *   mixed[ alternative[plain,html], 첨부들 ]   plain·html 이 둘 다 alternative 안
 *   mixed[ plain, 첨부들 ]                     html 이 없다
 *   mixed[ html, 첨부들 ]                      plain 이 없다
 *   mixed[ related[ alternative[p,h], 그림 ], 첨부 ]
 *
 * 걸리는 것은 본문이 **형제로 흩어진** 모양들이다. 그때는 물러난다 —
 * 느린 것이 글이 사라진 것보다 낫다.
 */
function planBody(root: MessageStructureObject): BodyPlan {
  const leaves: { node: PartNode; alternative: boolean }[] = [];
  let blocker = "";

  const walk = (
    node: MessageStructureObject,
    alternative: boolean,
    depth: number,
  ): void => {
    const type = (node.type ?? "").toLowerCase();
    if (type.startsWith("multipart/") && node.childNodes?.length) {
      // alternative 표시는 **자손에게만** 흐른다 — 형제에게는 안 간다.
      const alt = alternative || type === "multipart/alternative";
      for (const child of node.childNodes) walk(child, alt, depth + 1);
      return;
    }

    /*
     * 뿌리가 multipart 가 아닌 메일. 여기서 무조건 물러난다.
     *
     * 두 가지 때문이다. (1) mailparser 는 뿌리 조각에 규칙을 하나 더 쓴다 —
     * `node.root && !hasText` 이면 html 에서 글자 본문을 **지어낸다**.
     * (2) Content-Type 이 아예 없는 메일의 뿌리를 text/plain 으로 친다.
     * 어느 쪽도 조각 길이 흉내 내지 않는다.
     *
     * 잃는 것은 없다 — 조각이 하나뿐이면 건너뛸 것도 없어서 어차피 이 길로
     * 올 일이 없다. (본문 없이 파일 하나만 든 **비 multipart** 메일이 이론상
     * 여기 걸려 통째로 받게 되는데, 그런 메일은 사실상 없다.)
     */
    if (depth === 0) {
      blocker ||= "단일 파트";
      return;
    }

    const p = toPartNode(node);

    /*
     * `Content-Disposition: inline` 인 message/rfc822 는 mailsplit 이 **안쪽까지
     * 펴서** 읽는다(`message-splitter.js`, `messageNode = true`). 그러면 안쪽
     * 메일의 본문과 머리말 표가 바깥 본문에 섞여 나온다. 우리는 그 안쪽을
     * 통째로 못 지어내므로 여기서 물러난다.
     *
     * 인코딩 조건까지 함께 본다 — base64 로 감싼 것은 mailsplit 도 안 편다.
     */
    if (type === "message/rfc822") {
      const raw = p.encoding ?? "7bit";
      if (
        p.disposition === "inline" &&
        (raw === "7bit" || raw === "8bit" || raw === "binary")
      ) {
        blocker ||= "inline message/rfc822";
      }
      return;
    }

    if (!PARSER_TEXT_TYPES.has(type)) return;
    if (parserDisposition(p) !== "inline") return;

    leaves.push({ node: p, alternative });
  };

  walk(root, false, 0);

  const isHtml = (l: { node: PartNode }) => l.node.type === "text/html";
  const hasHtml = leaves.some(isHtml);
  const hasText = leaves.some((l) => !isHtml(l));
  const plainOutside = leaves.some((l) => !isHtml(l) && !l.alternative);
  const htmlOutside = leaves.some((l) => isHtml(l) && !l.alternative);

  if (!blocker && plainOutside && hasHtml) blocker = "글자 본문이 html 에 섞인다";
  if (!blocker && htmlOutside && hasText) blocker = "html 본문이 글자에 섞인다";

  return {
    parts: leaves.map((l) => l.node),
    faithful: !blocker,
    reason: blocker,
  };
}

/**
 * base64 는 3바이트를 4글자로 적는다. 서버가 준 것은 그 4글자 쪽 크기다.
 *
 * 그런데 서버가 세는 옥텟에는 **줄바꿈도 들어 있다.** base64 는 한 줄을 76자
 * 밑으로 끊게 되어 있어(RFC 2045), 76자마다 CRLF 두 바이트가 더 붙는다.
 * 3/4 로만 나누면 그만큼 크게 나온다 — 10MB 짜리 첨부가 목록에 10.3MB 로
 * 섰다(A/B 실측: 10,485,760 → 10,761,702, +2.63%).
 *
 * 76자 줄이면 78옥텟이 57바이트를 담으므로 실제 비율은 0.731 이다. 줄 길이를
 * 72·64 로 쓰는 인코더도 있는데 그때는 0.730·0.727 — 어느 쪽이든 0.5% 안이라,
 * 하나를 골라 쓰면 3/4 로 어림잡는 것보다 언제나 가깝다.
 *
 * 이 값은 **파서가 크기를 재 주지 못했을 때만** 쓰인다. 바이트를 다 받아 본
 * 길에서는 파서가 잰 정확한 크기가 이 값을 덮는다.
 */
const BASE64_DECODED_RATIO = 57 / 78;

function decodedSize(p: PartNode): number | null {
  if (p.size === null) return null;
  return p.encoding === "base64"
    ? Math.round(p.size * BASE64_DECODED_RATIO)
    : p.size;
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

/**
 * ── 본문을 여는 데 원문 전체가 필요한가 ──
 *
 * 앞에서는 `source: true` 로 RFC822 원문을 **통째로** 받았다. 두 문단을 읽으려고
 * 10MB 첨부를 함께 끌어왔다는 뜻이다. 실측(흉내 낸 회선: 왕복 30ms · 2.5MB/s):
 * 14MB 짜리 한 통에서 내려받기 5,808ms · 파싱 256ms, 3KB 짜리는 61ms · 1ms.
 *
 * 그런데 `bodyStructure` 는 이미 같은 요청에 실려 온다 — 어느 조각이 본문이고
 * 어느 조각이 첨부인지 **받기 전에** 알 수 있다. 그래서 갈래를 나눈다.
 *
 * ── 첫 왕복에서 앞부분을 함께 받는다 ──
 * `BODY.PEEK[]<0.131072>` 로 원문 앞 128KB 를 구조와 같이 받는다. 대부분의 메일은
 * 여기서 **끝난다** — 그러면 왕복 한 번으로 예전과 똑같은 길(원문 → mailparser)을
 * 간다. 첨부가 붙어 넘칠 때만 둘째 왕복이 생긴다.
 *
 * ── 넘쳤을 때: 조각만 받거나, 뒤를 이어 받거나 ──
 * 건너뛸 수 있는 바이트(첨부·인라인 그림)가 256KB 를 넘으면 **본문 조각만**
 * 받는다. 그렇지 않으면(예: 그냥 큰 HTML 한 덩이) 앞서 받은 128KB **뒤를 이어**
 * 받아서 붙인다 — 버리는 바이트가 없다.
 *
 * ── 조각만 받아도 잃는 것이 없어야 한다 ──
 * mailparser 를 버리지 않는다. 조각마다 그 조각의 MIME 헤더를 붙여 **같은
 * 파서에** 먹인다. base64·quoted-printable 을 푸는 것도, euc-kr·shift_jis 를
 * 유니코드로 돌리는 것도 그대로 그쪽 일이다. 주소·제목은 `BODY.PEEK[HEADER]`
 * 를 같은 파서에 먹여 얻는다 — 예전과 **글자 그대로 같은 코드**가 만든다.
 *
 * 잃는 것 하나: 파서가 재 주던 첨부의 **정확한 크기**. 조각만 받으면 서버가 준
 * 인코딩된 크기에서 어림잡는다(base64 는 CRLF 때문에 2.6% 남짓 크게 나온다).
 * 목록에 뜨는 숫자가 조금 후해지는 것이고, 이름·타입·내려받기는 그대로다.
 *
 * ── 어느 모양에서 물러나는가 ──
 * 조각을 고르는 눈은 `planBody` 하나다. 거기 적힌 규칙은 mailparser 의 것을
 * 그대로 옮긴 것이고, **두 길의 결과가 글자 그대로 같아지는 모양에서만**
 * 조각 길로 간다. 물러나는 대표적인 자리는 본문 조각이 alternative 밖에
 * **형제로 흩어진** 모양(메일링 리스트 꼬리말) · `inline` 인 message/rfc822 ·
 * 보관(embed) 이다.
 */

/** 첫 왕복에 원문 앞부분을 얼마나 함께 받아 볼 것인가. */
const PEEK_BYTES = 128 * 1024;

/**
 * 이만큼 넘게 건너뛸 수 있을 때만 조각만 받는 길로 간다.
 *
 * 왕복이 한 번 더 늘기 때문이다. 왕복 30ms 짜리 회선에서 2.5MB/s 면 256KB 를
 * 건너뛰는 값이 100ms 남짓 — 왕복 하나(30ms)보다 확실히 크다. 이보다 작으면
 * 뒤를 이어 받아 예전 길로 가는 편이 빠르다.
 */
const MIN_SKIP_BYTES = 256 * 1024;

/**
 * 본문을 만드는 데 쓰는 재료. 두 길(원문 통째 / 조각만)이 같은 모양을 낸다.
 */
interface MessageBody {
  from: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  subject: string | null;
  /** 정제 전 HTML. */
  html: string | null;
  text: string | null;
  /**
   * 파서가 본 첨부들. **조각만 받은 길에서는 비어 있다** — 바이트를 안 받았으니
   * 파서가 볼 것도 없다. 부르는 쪽이 그때는 서버가 준 구조만 믿는다.
   */
  attachments: ParsedAttachment[];
}

function bodyFromParsed(parsed: ParsedMail): MessageBody {
  return {
    from: parsedAddrToMailAddr(parsed.from),
    to: parsedAddrToMailAddr(parsed.to),
    cc: parsedAddrToMailAddr(parsed.cc),
    subject: parsed.subject ?? null,
    html:
      typeof parsed.html === "string" && parsed.html.length > 0
        ? parsed.html
        : null,
    text: parsed.text ?? null,
    attachments: parsed.attachments ?? [],
  };
}

/**
 * 서버가 `BODY[n.MIME]` 을 안 줬을 때 그 조각의 MIME 헤더를 되짚어 세운다.
 *
 * bodyStructure 에 이미 타입·매개변수·인코딩이 다 있다. **charset 이 반드시
 * 실려야 한다** — 이 한 줄이 빠지면 mailparser 가 euc-kr 바이트를 UTF-8 로
 * 읽어 한글이 통째로 깨진다.
 */
function synthesizeMimeHeader(p: PartNode): Buffer {
  const params = Object.entries(p.parameters ?? {})
    .map(([k, v]) => `; ${k}="${String(v).replace(/"/g, "")}"`)
    .join("");
  return Buffer.from(
    `Content-Type: ${p.type}${params}\r\n` +
      `Content-Transfer-Encoding: ${p.encoding ?? "8bit"}\r\n\r\n`,
    "utf8",
  );
}

/**
 * 헤더 블록은 **빈 줄로 끝나야** 파서가 여기까지가 헤더라고 안다.
 *
 * `BODY[n.MIME]` 에 그 빈 줄을 붙여 주는 서버가 대부분이지만 규격이 못 박아
 * 두지는 않았다. 안 붙여 주는 서버에서 그대로 이어 붙이면 헤더 마지막 줄과
 * 본문 첫 줄이 한 줄로 붙어 본문이 통째로 깨진다. 한 줄로 막아 둔다.
 */
function withHeaderTerminator(header: Buffer): Buffer {
  const s = header.toString("binary");
  /*
   * 헤더가 **하나도 없는** 조각은 이 블록 자체가 그 빈 줄이다.
   *
   *     --boundary
   *                   ← 여기 (RFC 2046 이 허용한다. 기본값 text/plain)
   *     본문 첫 줄
   *
   * 그런 조각의 `BODY[n.MIME]` 은 CRLF 두 바이트뿐이라 아래 `endsWith("\r\n\r\n")`
   * 에 안 걸린다. 그대로 두면 한 줄을 더 붙여, 파서가 그 둘째 빈 줄을 **본문의
   * 첫 줄**로 읽는다 — 화면의 글이 빈 줄 하나로 밀린다(A/B 실측).
   */
  if (s === "\r\n" || s === "\n") return header;
  if (s.endsWith("\r\n\r\n") || s.endsWith("\n\n")) return header;
  return Buffer.concat([
    header,
    Buffer.from(s.endsWith("\r\n") || s.endsWith("\n") ? "\r\n" : "\r\n\r\n"),
  ]);
}

/**
 * 본문 조각들만 받아 본문을 만든다. 하나라도 못 받으면 `null` —
 * 부르는 쪽이 예전 길(원문 통째)로 물러난다. **반쪽짜리 본문을 내지 않는다.**
 */
async function fetchBodyParts(
  client: ImapFlow,
  uid: number,
  bodies: PartNode[],
): Promise<MessageBody | null> {
  const keys: string[] = [];
  for (const p of bodies) keys.push(`${p.part}.MIME`, p.part);

  const res = await client.fetchOne(
    String(uid),
    { uid: true, headers: true, bodyParts: keys },
    { uid: true },
  );
  if (!res) return null;
  const headers = res.headers as Buffer | undefined;
  // 본문 조각이 아예 없는 메일(첨부만 든 메일)도 있다 — 그때는 헤더만 온다.
  if (!headers || (bodies.length > 0 && !res.bodyParts)) return null;

  const got = new Map<string, Buffer>();
  for (const [k, v] of res.bodyParts ?? []) got.set(k.toLowerCase(), v);

  /*
   * ── 길이 0 인 리터럴 하나가 **뒤의 조각을 통째로 밀어 버린다** ──
   *
   * 서버가 `BODY[1.MIME] {0}` 처럼 빈 리터럴을 주면 imapflow 의 셈이 어긋난다.
   * 스트림 쪽은 빈 버퍼를 하나 쌓아 두는데(`imap-stream.js`) 토큰 파서는
   * 길이가 0 이면 "기다릴 것 없다" 며 그 하나를 **꺼내 쓰지 않는다**
   * (`token-parser.js`, "special case where literal content length is 0").
   * 그때부터 모든 리터럴이 한 칸씩 밀려, 2번 조각 자리에 1번 조각의 바이트가
   * 들어앉는다. 실측: 빈 리터럴을 주는 서버에서 `BODY[1.2]`(HTML) 자리에
   * `BODY[1.1]`(글자)의 내용이 왔다 — 화면에는 **다른 글이 뜬다.**
   *
   * 밀린 자리는 값이 `undefined` 로 남는다. 그것이 유일한 표시다. 조각을
   * 청해 놓고 그런 자리가 하나라도 있으면 이 응답 전체를 믿지 않고 예전
   * 길로 물러난다 — 조용히 남의 본문을 띄우는 것보다 한 왕복이 낫다.
   *
   * (키가 **아예 없는** 것은 다른 이야기다. 그건 서버가 그 section 을 모르는
   * 것이고, 아래에서 구조로 헤더를 지어 쓴다. 여기서 거르는 것은 "키는
   * 왔는데 값이 버퍼가 아닌" 자리뿐이다.)
   */
  for (const [k, v] of got) {
    if (!Buffer.isBuffer(v)) {
      console.warn(
        `[mail] 조각 응답이 밀렸다 — 예전 길로 물러난다 (uid=${uid} ${k})`,
      );
      return null;
    }
  }

  // 주소·제목은 예전과 **같은 파서**가 같은 바이트에서 뽑는다
  const head = await simpleParser(headers);

  const htmls: string[] = [];
  const texts: string[] = [];

  for (const p of bodies) {
    const raw = got.get(p.part.toLowerCase());
    if (!raw) return null;
    const mime = got.get(`${p.part}.mime`.toLowerCase());
    const mini = Buffer.concat([
      mime && mime.length
        ? withHeaderTerminator(mime)
        : synthesizeMimeHeader(p),
      raw,
    ]);
    /*
     * `skipHtmlToText: true` — **조각 하나만 볼 때만 도는 줄을 아예 막는다.**
     *
     * html 조각을 홀로 파싱하면 그 조각이 mini 메시지의 **뿌리**가 되어
     * `hasText === false` 가 되고, mailparser 의 `getTextContent` 가
     * `(node.root && !this.hasText)` 가지를 타 `htmlToText()` 를 돈다
     * (`mail-parser.js:776`). 원문을 통째로 볼 때는 그 html 이 alternative
     * 안이라(`alternative=true`·`hasText=true`) **한 번도 안 걸리는 줄이다.**
     *
     * 거기서 던지면 mailparser 가 `'error'` 를 내고 `simpleParser` 가 reject
     * 하며, 그 예외가 여기를 뚫고 라우트의 500 이 된다. 값이 조용히 달라지는
     * 것이 아니라 **그 메일이 아예 안 열린다.** 실측: `<div>` 2,312겹 ·
     * `<blockquote>` 2,256겹 · `<table><tr><td>` 758겹부터 던진다. 옛 코드는
     * 같은 메일을 137ms 에 멀쩡히 열었다. 깊이는 **보내는 쪽이 정하는 값**이라
     * 아무 발신자나 만들 수 있다.
     *
     * 이 손잡이는 그 자리에서 빈 글자를 넣고 지나간다. 아래에서 보듯 우리는
     * html 조각의 `one.text` 를 **일부러 버리므로** 잃는 것이 없다. 덤으로
     * 버릴 글자를 짓느라 쓰던 값도 사라진다 (672KB 뉴스레터 129ms → 6ms).
     */
    const one = await simpleParser(mini, {
      keepCidLinks: true,
      skipHtmlToText: true,
    });
    if (p.type === "text/html") {
      if (typeof one.html === "string" && one.html.length > 0) {
        htmls.push(one.html);
      }
      /*
       * **HTML 에서 글자 본문을 지어내지 않는다.** 조각 하나만 주면 mailparser
       * 가 친절하게 HTML→글자 변환본을 `text` 에 넣어 주는데, 원문을 통째로
       * 볼 때는 그러지 않는다(A/B 실측: text/plain 이 없는 메일에서 예전 길은
       * `text: null`). 여기서 그걸 받아 담으면 조각만 받은 메일에서만 글자
       * 본문이 생겨 두 길의 결과가 갈린다.
       */
    } else if (one.text) {
      texts.push(one.text);
    }
  }

  return {
    from: parsedAddrToMailAddr(head.from),
    to: parsedAddrToMailAddr(head.to),
    cc: parsedAddrToMailAddr(head.cc),
    subject: head.subject ?? null,
    // 여러 덩이일 때 잇는 방식은 mailparser 가 원문 하나를 볼 때와 같게 맞춘다
    html: htmls.length ? htmls.join("<br/>\n") : null,
    text: texts.length ? texts.join("\n") : null,
    attachments: [],
  };
}

/** 앞서 받아 둔 `from` 바이트 **뒤를** 이어 받는다. 버리는 바이트가 없다. */
async function fetchSourceFrom(
  client: ImapFlow,
  uid: number,
  from: number,
): Promise<Buffer> {
  const res = await client.fetchOne(
    String(uid),
    { uid: true, source: { start: from } },
    { uid: true },
  );
  if (!res) return Buffer.alloc(0);
  return (res.source as Buffer | undefined) ?? Buffer.alloc(0);
}

/** 이 열기가 어디에 시간을 썼나. 운영 로그에 한 줄로 남는다. */
export interface FetchMessageTimings {
  /** 구조 + 원문 앞부분을 받은 첫 왕복. */
  head: number;
  /** 둘째 왕복 (조각만 받기 / 뒤 이어 받기). 없었으면 0. */
  more: number;
  /** mailparser 가 쓴 시간. */
  parse: number;
  /** 정제 + 첨부 목록. */
  render: number;
  /** IMAP 에서 실제로 끌어온 바이트. */
  bytes: number;
  /** 어느 길로 갔나. */
  path: "whole" | "resumed" | "parts";
  /**
   * 조각 길을 두고 물러났다면 왜. 빈 글자면 물러날 일이 없었다는 뜻이다.
   *
   * 운영 로그에 남긴다 — "왜 이 메일만 느린가" 를 다음 사람이 코드를 읽지
   * 않고 답할 수 있어야 해서다. 물러나는 비율이 슬금슬금 오르는 것도 이
   * 한 줄로 보인다.
   */
  fallback: string;
}

export async function fetchMessageFromClient(
  client: ImapFlow,
  uid: number,
  folder = "INBOX",
  ctx: FetchMessageContext = { accountId: 0 },
): Promise<MailMessageDetail> {
  const lock = await client.getMailboxLock(folder);
  try {
    return await fetchMessageWithLock(client, uid, ctx);
  } finally {
    lock.release();
  }
}

/**
 * 메일함 잠금을 **이미 쥔 채로** 부르는 길.
 *
 * 연결 풀에서 빌린 연결은 빌릴 때 이미 잠금을 잡는다. 여기서 또 잡으면 같은
 * 연결의 잠금을 두 번 요구하는 셈이고, imapflow 의 잠금은 한 번에 하나라
 * **스스로를 기다리다 멎는다.**
 */
export async function fetchMessageWithLock(
  client: ImapFlow,
  uid: number,
  ctx: FetchMessageContext = { accountId: 0 },
  timings?: FetchMessageTimings,
): Promise<MailMessageDetail> {
  const mode: InlineImageMode = ctx.inlineImages ?? "link";
  const t0 = Date.now();

  const result = await client.fetchOne(
    String(uid),
    {
      /*
       * 원문을 **앞부분만** 받는다. 짧은 메일은 이 한 번으로 끝나고, 첨부가
       * 붙어 넘칠 때만 둘째 왕복이 생긴다.
       */
      source: { start: 0, maxLength: PEEK_BYTES },
      /*
       * **RFC822.SIZE 는 청하지 않는다.** 앞에서는 그 값으로 "다 받았다" 를
       * 판단했는데, 서버가 실제보다 작게 부르는 일이 있다 — LF 로 저장하고
       * CRLF 로 내주는 서버가 그렇다(줄 수만큼 작게 나온다). 그러면 앞 128KB
       * 만 쥐고도 다 받았다고 믿어 **잘린 원문을 파서에 먹인다.** 오류도
       * 신호도 없다. 실측: 원문 135,164바이트를 130,502 로 답한 서버에서
       * html 130,202 → 126,270 으로 잘렸다(한글 한 자가 반 토막 난 채로).
       *
       * 믿을 수 있는 신호는 하나뿐이다 — **청한 것보다 적게 왔으면 거기가
       * 끝이다.** 그것만 쓴다. 값을 아예 안 받아 두면 다음 사람이 그것으로
       * 다시 판단할 길도 없다.
       */
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
       * 다룬다). 그리고 이제는 이것이 **어느 조각만 받을지**를 정한다.
       */
      bodyStructure: true,
    },
    { uid: true },
  );
  if (!result) {
    throw new Error(`메시지를 찾을 수 없습니다 (UID ${uid})`);
  }
  const tHead = Date.now();

  const peek = (result.source as Buffer | undefined) ?? Buffer.alloc(0);
  /*
   * 다 받았나. **서버가 우리가 청한 것보다 적게 줬으면 거기가 끝이다** —
   * 이것만 믿는다(위 fetch 의 RFC822.SIZE 주석 참고). 딱 128KB 짜리 메일은
   * 이 잣대로 한 번 더 물어보게 되는데, 그 한 왕복이 잘린 본문보다 싸다.
   */
  const whole = peek.length < PEEK_BYTES;

  const structure = result.bodyStructure
    ? flattenStructure(result.bodyStructure)
    : [];

  /*
   * ── 언제 조각만 받아도 되는가 ──
   *
   * 보관("embed")은 이 길로 못 온다 — 인라인 그림의 **바이트**를 본문에 구워야
   * 하는데 조각만 받으면 그 바이트가 없다. 보관본은 원본이 사라져도 열려야
   * 하므로 여기서 속도를 아끼면 안 된다.
   *
   * 나머지 판단은 `planBody` 가 한다 — mailparser 가 원문을 통째로 봤을 때
   * 무엇을 본문에 넣는지를 그대로 옮겨 놓은 곳이다. 거기서 "같은 결과가
   * 나온다"고 한 모양에서만 조각 길로 간다.
   *
   * 글자 조각이 **아예 없는** 메일(파일 하나만 보낸 메일)도 여기 든다.
   * 그때는 본문이 없다는 것이 확실하니 헤더만 받는다 — 7MB 짜리 zip 을 본문
   * 대신 끌어올 이유가 없다.
   */
  const plan = result.bodyStructure
    ? planBody(result.bodyStructure)
    : { parts: [], faithful: false, reason: "구조 없음" };
  const bodies = plan.parts;

  // 받지 **않을** 바이트. 본문으로 고르지 않은 잎이 전부 여기 든다.
  const keep = new Set(bodies.map((p) => p.part));
  const skippable = structure
    .filter((p) => !keep.has(p.part))
    .reduce((n, p) => n + (p.size ?? 0), 0);

  const splittable =
    !whole &&
    mode === "link" &&
    // 구조를 못 받았으면 무엇을 건너뛸지 알 수 없다
    structure.length > 0 &&
    plan.faithful &&
    skippable >= MIN_SKIP_BYTES;

  let body: MessageBody | null = null;
  let path: FetchMessageTimings["path"] = "whole";
  let bytes = peek.length;
  let tMore = tHead;
  let tParse = tHead;
  /*
   * 왜 조각 길로 못 갔나. **아낄 것이 있었는데** 못 간 것만 사연이다 —
   * 건너뛸 바이트가 애초에 없던 메일(그냥 큰 HTML 한 덩이)은 물러난 것이
   * 아니라 갈 곳이 없었던 것이라, 여기에 적으면 로그가 거짓말을 한다.
   * 조각이 하나뿐인 메일이 바로 그 경우다 — 그 하나가 본문이므로 건너뛸
   * 것이 있을 수 없다.
   */
  let fallback =
    !whole &&
    mode === "link" &&
    structure.length > 1 &&
    skippable >= MIN_SKIP_BYTES
      ? plan.reason
      : "";

  if (splittable) {
    /*
     * **던져도 물러난다.** 조각 길이 스스로 물러나는 표시는 `null` 뿐이라,
     * 여기서 예외가 나면 물러날 길이 없어 라우트가 500 을 내고 그 메일은
     * 다시 열어도 같은 길로 가 **영영 안 열린다.** 조각 길은 빠르자고 만든
     * 곁길이지 유일한 길이 아니다 — 무슨 이유로든 실패하면 예전 길이 답한다.
     * (알려진 한 가지는 위 `skipHtmlToText` 로 막았다. 이건 그 다음을 위한
     * 그물이다.)
     */
    try {
      body = await fetchBodyParts(client, uid, bodies);
    } catch (err) {
      console.warn(
        `[mail] 조각 길이 던졌다 — 예전 길로 물러난다 (uid=${uid})`,
        err,
      );
      body = null;
    }
    if (!body) {
      // fetchBodyParts 가 스스로 물러났다 (밀린 응답 / 못 받은 조각 / 던짐)
      fallback = "조각 응답을 못 믿는다";
    }
    if (body) {
      path = "parts";
      tMore = Date.now();
      tParse = tMore; // 조각 길에서는 받기와 파싱이 한 함수 안에 섞여 있다
      bytes += bodies.reduce((n, p) => n + (p.size ?? 0), 0);
    }
  }

  if (!body) {
    const source = whole
      ? peek
      : Buffer.concat([peek, await fetchSourceFrom(client, uid, peek.length)]);
    path = whole ? "whole" : "resumed";
    bytes = source.length;
    tMore = Date.now();
    /*
     * `keepCidLinks: true` — 기본값(false)이면 mailparser 가 본문의 `cid:` 를
     * `data:<타입>;base64,…` 로 **먼저 갈아치운다.** 그러면 우리가 주소를
     * 바꿀 기회가 없고, 그림 한 장이 본문에 통째로 박혀 1MB 캐시 상한을 넘겨
     * 그 메일은 영영 캐시를 못 탄다(그 사실은 로그에도 안 남는다).
     *
     * `cid:` 를 남겨 두고 아래 정책이 갈래를 정한다 — 화면이면 우리 라우트로,
     * 보관이면 여기서 직접 data: 로 굽는다.
     */
    body = bodyFromParsed(await simpleParser(source, { keepCidLinks: true }));
    tParse = Date.now();
  }

  const attachmentsRaw: ParsedAttachment[] = body.attachments;

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

  const from = body.from[0] ?? { name: null, email: "" };

  const htmlRaw = body.html;
  const text = body.text;

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

  const detail: MailMessageDetail = {
    id: String(uid),
    subject: body.subject ?? result.envelope?.subject ?? "(제목 없음)",
    from,
    receivedAt: result.internalDate
      ? new Date(result.internalDate).getTime()
      : Date.now(),
    snippet: null,
    unread: !result.flags?.has("\\Seen"),
    to: body.to,
    cc: body.cc,
    html,
    text,
    attachments: listAttachments(structure, attachmentsRaw, byPartId, usedCids),
    blockedTrackers,
    proxiedImages,
  };

  if (timings) {
    timings.head = tHead - t0;
    timings.more = tMore - tHead;
    timings.parse = tParse - tMore;
    timings.render = Date.now() - tParse;
    timings.bytes = bytes;
    timings.path = path;
    timings.fallback = fallback;
  }
  return detail;
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
      // 번호가 맞을 때만 파서 값을 얹는다 — 파서는 **디코딩된 크기**를 안다.
      const guess = byPartId.get(part.part);
      const matched =
        guess && guess.contentType?.toLowerCase() === part.type ? guess : null;
      out.push({
        id: part.part,
        /*
         * 이름은 **서버가 준 것을 먼저** 쓴다 (imapflow 가 푼 값).
         *
         * 둘 다 MIME 인코딩을 푼다. `=?UTF-8?B?…?=` 도, `=?euc-kr?B?…?=` 도,
         * RFC 2231 로 쪼갠 `filename*0*`/`filename*1*` 도 셋 다 같은 값이
         * 나온다(A/B 실측: uid 319·323·325).
         *
         * 갈리는 자리는 하나다 — 헤더에 한글이 **날것 UTF-8** 로 그냥 박힌
         * 메일(규격 위반이지만 흔하다). 거기서 파서는 그 바이트를 latin-1 로
         * 읽어 `ëì©ë.pdf` 를 내놓고, imapflow 는 `대용량.pdf` 를 내놓는다
         * (실측: uid 211·324).
         *
         * 앞에서는 파서를 먼저 썼다. 그래서 **같은 메일이 크기에 따라 다른
         * 이름으로 보였다** — 조각 길로 가면 옳은 이름, 원문을 통째로 받는
         * 길(보관·물러남)로 가면 깨진 이름. 한쪽으로 맞춘다.
         *
         * 서버가 구조에 이름을 안 실어 주면 `??` 가 파서 쪽으로 넘어간다.
         */
        filename: part.filename ?? matched?.filename ?? null,
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
  /**
   * 메일 한 통을 연다. **연결은 풀에서 빌린다.**
   *
   * 앞에서는 `withImapConnection` 이라 열 때마다 TCP+TLS+LOGIN+LIST+LSUB+
   * SELECT+LOGOUT 을 새로 했다 — 실제로 하는 일(FETCH 한 번)에 왕복 아홉 번을
   * 얹은 셈이다(측정: 명령 로그 기준). 첨부·인라인 그림이 쓰던 그 풀을 같이
   * 쓰면 데워진 연결에서는 그 아홉 번이 **한 번**이 된다.
   *
   * `long` 은 보관("embed")일 때만 참이다 — 그쪽만 원문을 통째로 끌어오므로
   * 연결을 오래 쥔다. 화면에 띄우려고 여는 것은 짧은 일이라, 첨부 두 개가
   * 흐르고 있어도 남겨 둔 자리 하나로 곧장 들어간다.
   */
  async fetchMessage(
    account: Account,
    messageId: string,
    options?: FetchMessageOptions,
  ): Promise<MailMessageDetail> {
    const uid = parseInt(messageId, 10);
    if (!Number.isFinite(uid)) throw new Error("유효하지 않은 message ID");
    const { folder } = parseImapView(account.query);
    const mode = options?.inlineImages ?? "link";

    const started = Date.now();
    const { client, release } = await borrowImapConnection(account, folder, {
      long: mode === "embed",
      busyMessage: "메일 서버가 바빠 본문을 못 받았습니다",
    });
    const borrowed = Date.now() - started;
    const t: FetchMessageTimings = {
      head: 0,
      more: 0,
      parse: 0,
      render: 0,
      bytes: 0,
      path: "whole",
      fallback: "",
    };
    try {
      return await fetchMessageWithLock(
        client,
        uid,
        { accountId: account.id, inlineImages: mode },
        t,
      );
    } finally {
      release();
      /*
       * 어디에 시간을 썼는지 남긴다. 라우트의 한 줄은 합계만 말해 주는데,
       * 그것만으로는 "연결을 여느라 느린가, 바이트가 많아 느린가" 를 가를 수
       * 없어 이번 작업이 시작됐다. 다음에는 로그가 먼저 말해 주게 한다.
       */
      console.log(
        `[mail] 본문 내역 account=${account.id} uid=${uid} ` +
          `conn=${borrowed}ms head=${t.head}ms more=${t.more}ms ` +
          `parse=${t.parse}ms render=${t.render}ms ` +
          `${t.path} ${Math.round(t.bytes / 1024)}KB` +
          (t.fallback ? ` (물러남: ${t.fallback})` : ""),
      );
    }
  },
};
