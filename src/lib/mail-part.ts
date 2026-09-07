import { Readable } from "node:stream";

import { eq } from "drizzle-orm";
import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import { db, schema } from "./db";
import type { Account } from "./db/schema";
import { borrowImapConnection, PartError } from "./imap-pool";
import { parseImapView } from "./providers/imap";

/*
 * 연결 풀은 **여기 있었다.** 본문 열기도 같은 풀을 타야 해서 `imap-pool.ts`
 * 로 옮겼다 — 두 벌이 되면 같은 계정에 연결이 두 배로 열리고, 그것이 이
 * 풀이 애초에 막으려던 고장이다. 왜 그렇게 생겼는지는 그 파일의 머리말에.
 *
 * `PartError` 도 그쪽으로 갔지만 라우트들이 여기서 가져다 쓰므로 다시 내보낸다.
 */
export { PartError };

/**
 * 메일 한 통의 **조각 하나**를 IMAP 에서 꺼내 온다.
 *
 * 핵심은 언제 꺼내느냐다 — 자동 수집은 여전히 봉투만 받고, 사람이 메일을 열어도
 * 첨부 바이트는 오지 않는다. 여기까지 오는 것은 사람이 내려받기 단추를 눌렀거나
 * 브라우저가 본문의 인라인 그림을 그리려고 우리 주소를 불렀을 때뿐이다.
 *
 * **바이트를 디스크에 쓰지 않는다.** 첨부는 IMAP 소켓에서 응답 스트림으로 곧장
 * 흘려보내고(메모리에도 안 모은다), 인라인 그림만 앞머리를 봐야 해서 상한까지
 * 메모리에 들고 있다가 버린다.
 */

/** IMAP body part 번호. 이 모양이 아닌 값은 IMAP 명령에 절대 넣지 않는다. */
const PART_ID = /^[0-9]+(?:\.[0-9]+)*$/;
/** 서버가 구조를 안 줬을 때의 자리표 — 파서가 본 첨부 배열의 번호. */
const INDEX_ID = /^i([0-9]+)$/;

/**
 * 소켓으로 흘러 오는 **인코딩된** 바이트의 상한.
 *
 * base64 는 3바이트를 4글자로 적으므로 실제 파일은 대략 이 값의 3/4 이하다.
 * 상한을 왜 두는가 — 상한이 없으면 한 요청이 컨테이너의 메모리와 대역을
 * 무한히 쓴다. 넘으면 스트림을 시작하기 전에 413 으로 거절한다(시작한 뒤에
 * 끊으면 사람 손에는 잘린 파일이 남는다).
 */
export const MAX_ATTACHMENT_TRANSFER_BYTES = 40 * 1024 * 1024;

/** 본문에 그릴 그림 한 장. 이보다 큰 인라인 그림은 그릴 이유가 없다. */
export const MAX_INLINE_BYTES = 10 * 1024 * 1024;

/** 한 조각을 받는 데 쓰는 시간. IMAP 의 유휴 타임아웃과 별개의 벽시계다. */
const PART_TIMEOUT_MS = 60_000;

/**
 * 주소의 두 조각을 계정 행과 UID 로.
 *
 * 두 라우트가 똑같이 필요로 하는 문지기라 한 곳에 둔다 — 나눠 적으면 언젠가
 * 한쪽만 고쳐진다. (로그인 검사는 미들웨어가 `/api/…` 전체에 이미 걸어 둔다.)
 */
export function resolveTarget(
  accountId: string,
  messageId: string,
): { account: Account; uid: number } {
  const id = Number(accountId);
  if (!Number.isInteger(id)) throw new PartError("invalid account id", 400);

  const account = db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, id))
    .get();
  if (!account) throw new PartError("account not found", 404);

  const uid = Number.parseInt(decodeURIComponent(messageId), 10);
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new PartError("유효하지 않은 message ID", 400);
  }
  return { account, uid };
}

export interface PartMeta {
  /** 발신자가 선언한 MIME 타입. 라우트가 그대로 믿지 않는다. */
  declaredType: string | null;
  /** 발신자가 붙인 파일 이름. */
  filename: string | null;
}

/** 이 뷰가 보고 있는 메일함. 풀의 열쇠에 들어간다. */
function folderOf(account: Account): string {
  return parseImapView(account.query).folder;
}

/**
 * 서버가 bodyStructure 를 안 줘서 파트 번호를 모를 때의 되돌림 길.
 *
 * 원문을 통째로 다시 받아 파서가 본 순서대로 꺼낸다. 비싸다 — 20MB 첨부 하나에
 * 20MB 를 다시 끌어오고 전부 재파싱한다. 그래서 **되돌림일 뿐** 보통 길이
 * 아니다. 그래도 두는 이유는, 이 길이 없으면 그런 서버에서는 첨부를 아예 못
 * 받기 때문이다.
 *
 * ── 크기 상한이 여기서도 걸려야 한다 ──
 * 앞에서는 `fetchOne(uid, { source: true })` 에 상한이 없었고 부르는 쪽도
 * 안 넘겼다. `MAX_INLINE_BYTES`(10MB)·`MAX_ATTACHMENT_TRANSFER_BYTES`(40MB)가
 * **이 길에서는 없는 것과 같았다** — 200MB 첨부면 원문을 통째로 메모리에
 * 올렸다. 이제 `maxBytes + 1` 만큼만 받아서, 더 있으면 시작 전에 413 으로
 * 거절한다(정상 길이 하는 것과 같다).
 *
 * 이 길에서 재는 것은 **원문 전체**의 크기다. 조각 하나가 아니라 메일 한 통
 * 전부를 끌어오는 길이라 그것이 실제로 붙드는 메모리다. 그래서 40MB 짜리
 * 첨부 하나를 이 길로 받을 수는 없는데, 그건 되돌림 길의 값이지 고장이 아니다.
 */
async function partFromSource(
  client: ImapFlow,
  uid: number,
  index: number,
  maxBytes: number,
): Promise<{ body: Buffer } & PartMeta> {
  const res = await client.fetchOne(
    String(uid),
    // 한 바이트 더 받아 본다 — 넘치는지 알아야 잘린 것을 내보내지 않는다
    { source: { start: 0, maxLength: maxBytes + 1 }, uid: true },
    { uid: true },
  );
  if (!res) throw new PartError(`메시지를 찾을 수 없습니다 (UID ${uid})`, 404);
  const source = res.source as Buffer | undefined;
  if (!source) throw new PartError("메시지 원문을 받지 못했습니다", 502);
  if (source.length > maxBytes) {
    throw new PartError("메일이 너무 큽니다", 413);
  }
  const parsed = await simpleParser(source, {
    keepCidLinks: true,
  });
  const att = parsed.attachments?.[index];
  if (!att?.content) throw new PartError("그 조각을 찾을 수 없습니다", 404);
  return {
    body: att.content,
    declaredType: att.contentType ?? null,
    filename: att.filename ?? null,
  };
}

/**
 * 조각을 통째로 메모리에 받아 온다 (상한까지). 인라인 그림용.
 *
 * 앞머리를 봐야 정말 그림인지 알 수 있어서 흘려보내지 않는다 — 그림이 아닌
 * 것을 우리 오리진에서 내보내지 않으려면 다 받아 놓고 판정해야 한다.
 */
export async function readMessagePart(
  account: Account,
  uid: number,
  id: string,
  maxBytes = MAX_INLINE_BYTES,
): Promise<{ body: Buffer } & PartMeta> {
  // 짧은 일이다 — 다 받아 놓고 돌려주므로 연결을 오래 안 쥔다
  const { client, release } = await borrowImapConnection(
    account,
    folderOf(account),
    { long: false },
  );
  try {
    const idx = INDEX_ID.exec(id);
    // 되돌림 길에도 같은 상한을 넘긴다 — 앞에서는 인자를 여기서 버렸다
    if (idx) {
      return await partFromSource(client, uid, Number(idx[1]), maxBytes);
    }
    if (!PART_ID.test(id)) throw new PartError("조각 번호가 이상합니다", 400);

    const dl = await client.download(String(uid), id, {
      uid: true,
      maxBytes: maxBytes + 1,
    });
    if (!dl?.content) throw new PartError("그 조각을 찾을 수 없습니다", 404);

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of dl.content) {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size > maxBytes) {
        dl.content.destroy();
        throw new PartError("그림이 너무 큽니다", 413);
      }
      chunks.push(buf);
    }
    return {
      body: Buffer.concat(chunks),
      declaredType: dl.meta?.contentType ?? null,
      filename: dl.meta?.filename ?? null,
    };
  } finally {
    release();
  }
}

/**
 * 조각을 **스트림으로** 내보낸다. 첨부 내려받기용.
 *
 * 연결은 스트림이 끝나거나(끊기거나) 시간이 다할 때 닫는다. `withImapConnection`
 * 을 못 쓰는 이유가 이것이다 — 그쪽은 함수가 돌아오는 순간 로그아웃하는데,
 * 우리는 돌아온 **뒤에** 바이트가 흐른다.
 */
export async function streamMessagePart(
  account: Account,
  uid: number,
  id: string,
): Promise<{ stream: ReadableStream<Uint8Array> } & PartMeta> {
  /*
   * **오래 걸리는 일이다.** 함수가 돌아온 뒤에도 바이트가 흐르는 동안 연결을
   * 쥔다(최대 60초). 그래서 자리 상한이 따로 걸린다 — 첨부가 몰려도 인라인
   * 그림 몫으로 연결 하나는 남는다.
   */
  const { client, release } = await borrowImapConnection(
    account,
    folderOf(account),
    { long: true },
  );
  try {
    const idx = INDEX_ID.exec(id);
    if (idx) {
      // 되돌림 길에서는 이미 메모리에 다 있다. 한 덩이로 내보낸다.
      const got = await partFromSource(
        client,
        uid,
        Number(idx[1]),
        MAX_ATTACHMENT_TRANSFER_BYTES,
      );
      release();
      return {
        stream: new Response(new Uint8Array(got.body))
          .body as ReadableStream<Uint8Array>,
        declaredType: got.declaredType,
        filename: got.filename,
      };
    }
    if (!PART_ID.test(id)) throw new PartError("조각 번호가 이상합니다", 400);

    const dl = await client.download(String(uid), id, {
      uid: true,
      maxBytes: MAX_ATTACHMENT_TRANSFER_BYTES,
    });
    if (!dl?.content) throw new PartError("그 조각을 찾을 수 없습니다", 404);

    // 시작하기 전에 거절한다. 흘려보내다 끊으면 사람 손에는 **잘린 파일**이
    // 남고, 파일이 깨진 것인지 우리가 끊은 것인지 구분할 길이 없다.
    if ((dl.meta?.expectedSize ?? 0) > MAX_ATTACHMENT_TRANSFER_BYTES) {
      dl.content.destroy();
      throw new PartError("첨부가 너무 큽니다", 413);
    }

    const node = dl.content;
    const timer = setTimeout(() => node.destroy(), PART_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      release();
    };
    node.once("close", finish);
    node.once("error", finish);

    return {
      stream: Readable.toWeb(node) as ReadableStream<Uint8Array>,
      declaredType: dl.meta?.contentType ?? null,
      filename: dl.meta?.filename ?? null,
    };
  } catch (e) {
    release();
    throw e;
  }
}

/**
 * `Content-Disposition` 한 줄.
 *
 * ASCII 로 적은 이름과 `filename*=UTF-8''…` 를 **함께** 싣는다. 한글 이름이
 * 붙은 첨부가 `filename="___.pdf"` 로 떨어지거나 아예 깨진 이름으로 저장되는
 * 것을 막는 것은 뒤쪽뿐이고, 앞쪽은 그 문법을 모르는 오래된 클라이언트를 위한
 * 것이다(RFC 6266 이 둘을 같이 적으라고 한다).
 *
 * 따옴표와 역슬래시, 그리고 줄바꿈은 반드시 지운다 — 이름은 발신자가 적는
 * 값이라, 그대로 넣으면 헤더 한 줄을 통째로 조작할 수 있다.
 */
export function contentDisposition(
  kind: "attachment" | "inline",
  rawName: string | null,
): string {
  const name = (rawName ?? "").replace(/[\r\n]/g, " ").trim();
  if (!name) return kind;
  // 비ASCII·따옴표·역슬래시를 뺀 폴백. 다 빠지면 무난한 이름을 준다.
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `${kind}; filename="${ascii || "attachment"}"; filename*=UTF-8''${encoded}`;
}
