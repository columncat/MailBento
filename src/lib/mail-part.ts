import { Readable } from "node:stream";

import { eq } from "drizzle-orm";
import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import { db, schema } from "./db";
import type { Account } from "./db/schema";
import {
  basicCredsFromAccount,
  makeImapClient,
  parseImapView,
} from "./providers/imap";

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

export class PartError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

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

/**
 * ── 연결을 다시 쓰되, 하나로 묶지는 않는다 ──
 *
 * 두 고장 사이에서 균형을 잡는 자리다.
 *
 * **한쪽 끝(옛날): 요청마다 새 연결.** 인라인 그림 한 장마다 IMAP 로그인이
 * 한 번이었다. 그림 여덟 장이면 로그인 아홉 번. Gmail 은 계정당 동시 IMAP
 * 연결이 15개고, 넘기면 실패하며 반복되면 **계정이 일시 차단된다.** 화면에는
 * "이미지 없음" 조각만 남는다.
 *
 * **다른 쪽 끝(바로 앞): 계정+폴더당 연결 하나.** 로그인은 줄었지만 같은
 * 계정의 모든 조각 요청이 그 하나의 `getMailboxLock` 뒤에 줄을 섰다.
 * `streamMessagePart` 는 스트림이 닫힐 때까지(최대 60초) 잠금을 쥔다. 실측:
 * 30초 걸리는 첨부가 도는 동안 같은 메일의 인라인 그림이 **29,554ms**,
 * 다른 첨부가 29,555ms 를 기다렸다. 브라우저에서는 30초 동안 그림 자리가 빈다.
 *
 * ── 고른 길: 작은 풀 + 오래 걸리는 것에 자리 상한 ──
 * 계정+폴더마다 **최대 셋**까지 열고 빌려 쓴다. 왜 셋인가 — 로그인 폭증(그림
 * 여덟 장 = 아홉 번)으로 돌아가지 않으면서, 오래 걸리는 것 하나가 짧은 것을
 * 통째로 막지 못할 만큼은 되는 가장 작은 수다.
 *
 * 그리고 **오래 걸리는 일(첨부 스트림)은 셋 중 둘까지만** 쥔다. 이 한 줄이
 * "느린 첨부가 그림을 멎게 한다" 를 없앤다 — 첨부가 몇 개 오든 인라인 그림
 * 몫으로 자리 하나가 남는다. 스트림은 다 흐를 때까지 연결을 쥐는 일이라
 * 짧은 것과 같은 잣대로 다룰 수 없다.
 *
 * 기다리는 쪽에도 시간 상한을 준다. 앞에서는 상한이 아예 없어서, 잠금을 쥔
 * 쪽이 60초를 채우면 기다리는 쪽도 60초를 그대로 기다렸다.
 *
 * 다 쓰고 바로 안 끊는 이유: 브라우저가 조각들을 잇달아 부르는데 그 사이에
 * 끊으면 결국 매번 새로 로그인한다. 잠깐 열어 뒀다가 조용해지면 닫는다.
 */
const POOL_IDLE_MS = 30_000;

/** 계정+폴더당 열어 두는 연결 수. */
const MAX_POOL_PER_KEY = 3;

/**
 * 그중 **오래 걸리는 일**(첨부 스트림)이 한 번에 쥘 수 있는 수.
 * 나머지 하나는 언제나 짧은 일(인라인 그림) 몫으로 남는다.
 */
const MAX_LONG_PER_KEY = 2;

/** 자리가 나기를 기다리는 상한. 넘으면 60초를 그냥 기다리는 대신 끝낸다. */
const BORROW_TIMEOUT_MS = 15_000;

interface Pooled {
  client: ImapFlow;
  /** 지금 누가 쓰고 있나. **한 연결에 한 요청만** 태운다. */
  busy: boolean;
  /** 지금 쥔 쪽이 오래 걸리는 일인가 (반납할 때 셈을 되돌리려고 든다). */
  long: boolean;
  idle: NodeJS.Timeout | null;
}

interface Waiter {
  long: boolean;
  /** 자리를 넘겨받는다. `null` 이면 "자리가 났으니 다시 봐라" 는 뜻이다. */
  resume: (e: Pooled | null) => void;
}

interface Slot {
  entries: Pooled[];
  /** 지금 여는 중인 연결 수. 이걸 안 세면 동시에 열다 상한을 넘긴다. */
  opening: number;
  /**
   * 그중 **오래 걸리는 일** 몫으로 여는 중인 수.
   *
   * 왜 따로 세는가 — `longHeld` 가 이미 열린 것만 세면, 첨부 요청 셋이 **같은
   * tick 에** 들어왔을 때 셋 다 "지금 오래 걸리는 일은 없네" 를 보고 각자
   * 연결을 연다. `MAX_LONG_PER_KEY` 가 안 걸려 풀(3)이 통째로 첨부에 잡히고,
   * 그 뒤에 온 인라인 그림은 15초를 기다리다 504 가 된다(실측: rig/r2-c3.ts,
   * **504 @ 15,012ms**). 자리는 `open()` 을 기다리기 **전에** 잡아 둬야 한다.
   */
  openingLong: number;
  waiting: Waiter[];
}

const pool = new Map<string, Slot>();

function poolKey(account: Account, folder: string): string {
  return [
    account.id,
    account.imapHost,
    account.imapPort,
    account.imapUsername,
    folder,
  ].join(" ");
}

function slotOf(key: string): Slot {
  let s = pool.get(key);
  if (!s) {
    s = { entries: [], opening: 0, openingLong: 0, waiting: [] };
    pool.set(key, s);
  }
  return s;
}

/**
 * 지금 오래 걸리는 일이 쥐고 있는 연결 수.
 * **여는 중인 것도 센다** — 위 `openingLong` 주석 참고.
 */
function longHeld(s: Slot): number {
  let n = s.openingLong;
  for (const e of s.entries) if (e.busy && e.long) n++;
  return n;
}

/** 이 종류가 지금 자리를 잡아도 되나. */
const mayTake = (s: Slot, long: boolean): boolean =>
  !long || longHeld(s) < MAX_LONG_PER_KEY;

/** 풀에서 이 연결을 들어낸다. 닫지는 않는다. */
function drop(key: string, e: Pooled): void {
  const s = pool.get(key);
  if (!s) return;
  if (e.idle) {
    clearTimeout(e.idle);
    e.idle = null;
  }
  const i = s.entries.indexOf(e);
  if (i >= 0) s.entries.splice(i, 1);
  // 자리가 하나 났으니 기다리는 쪽이 새로 열 수 있다
  wake(key);
  if (!s.entries.length && !s.waiting.length && !s.opening) pool.delete(key);
}

/** 들어내고 닫는다. 두 번 불려도 탈이 없어야 한다. */
function evict(key: string, e: Pooled): void {
  drop(key, e);
  e.client.logout().catch(() => {
    try {
      e.client.close();
    } catch {
      /* 이미 끊긴 연결 */
    }
  });
}

function hold(e: Pooled, long: boolean): Pooled {
  if (e.idle) {
    clearTimeout(e.idle);
    e.idle = null;
  }
  e.busy = true;
  e.long = long;
  return e;
}

/**
 * 자리가 났다고 알린다 — 넘겨줄 연결이 없으면 "다시 보라" 고만 한다.
 * 실제로 넘겨줬으면 true.
 *
 * 넘겨줄 것이 있어도 **못 넘기는 경우가 있다**: 기다리는 것이 전부 오래 걸리는
 * 일인데 그 몫(둘)이 이미 찼을 때다. 그때 false 를 돌려주어야 부르는 쪽이
 * 유휴 시계를 걸어 준다 — 안 그러면 아무도 안 쓰는 연결이 계속 열려 있는다.
 */
function wake(key: string, give?: Pooled): boolean {
  const s = pool.get(key);
  if (!s) return false;
  const i = s.waiting.findIndex((w) => mayTake(s, w.long));
  if (i < 0) return false;
  const w = s.waiting.splice(i, 1)[0];
  /*
   * 연결을 **곧장 넘긴다**(잡아 놓은 채로). 깨워 놓고 스스로 찾게 하면, 깨어난
   * 사이에 다른 요청이 끼어들어 그 연결을 가로챈다.
   */
  w.resume(give ? hold(give, w.long) : null);
  return give !== undefined;
}

async function open(account: Account, key: string): Promise<Pooled> {
  const client = makeImapClient(basicCredsFromAccount(account));
  /*
   * 상대가 먼저 끊는 일은 늘 있다(유휴 정리·서버 재시작). 그때 풀에 시체가
   * 남아 있으면 다음 요청이 그걸 빌려 갔다가 실패한다. 끊기는 즉시 들어낸다.
   * 'error' 를 안 받으면 소켓 오류가 unhandled 로 올라와 프로세스를 죽인다.
   */
  const entry: Pooled = { client, busy: false, long: false, idle: null };
  client.on("close", () => drop(key, entry));
  client.on("error", () => {});
  await client.connect();
  return entry;
}

/** 빌릴 수 있을 때까지 기다린다. 시간이 다하면 던진다. */
function waitForSlot(
  key: string,
  long: boolean,
  deadline: number,
): Promise<Pooled | null> {
  const s = slotOf(key);
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const w: Waiter = {
      long,
      resume: (e) => {
        clearTimeout(timer);
        resolve(e);
      },
    };
    timer = setTimeout(
      () => {
        const i = s.waiting.indexOf(w);
        if (i >= 0) s.waiting.splice(i, 1);
        reject(new PartError("메일 서버가 바빠 조각을 못 받았습니다", 504));
      },
      Math.max(1, deadline - Date.now()),
    );
    s.waiting.push(w);
  });
}

/** 쓸 연결 하나를 잡는다. 잡은 것은 반드시 `giveBack` 으로 돌려준다. */
async function take(
  account: Account,
  key: string,
  long: boolean,
): Promise<Pooled> {
  const deadline = Date.now() + BORROW_TIMEOUT_MS;
  for (;;) {
    const s = slotOf(key);
    if (mayTake(s, long)) {
      const free = s.entries.find((e) => !e.busy && e.client.usable);
      if (free) return hold(free, long);
      if (s.entries.length + s.opening < MAX_POOL_PER_KEY) {
        /*
         * 여는 중인 것도 세어야 한다. 안 세면 동시에 들어온 여덟 요청이
         * "아직 아무것도 없네" 하고 여덟 개를 한꺼번에 연다 — 그것이 바로
         * 되돌아가면 안 되는 로그인 폭증이다.
         */
        s.opening++;
        // 오래 걸리는 일의 몫은 **여기서** 잡는다. `await` 뒤로 미루면 같은
        // tick 에 들어온 다음 요청이 이 자리를 못 보고 그냥 지나간다.
        if (long) s.openingLong++;
        try {
          const e = await open(account, key);
          s.entries.push(e);
          // hold() 가 먼저 돌고 finally 가 뒤에 돈다 — 셈이 끊기지 않는다
          return hold(e, long);
        } finally {
          // 여는 동안에는 opening > 0 이라 이 slot 이 지워지지 않는다
          s.opening--;
          if (long) s.openingLong--;
        }
      }
    }
    const given = await waitForSlot(key, long, deadline);
    if (given) return given; // 넘겨받았다 (이미 잡힌 상태)
    // null 이면 "자리가 났다" 는 뜻 — 위에서 다시 본다
  }
}

function giveBack(key: string, e: Pooled): void {
  e.busy = false;
  e.long = false;
  const s = pool.get(key);
  if (!s) return;
  if (!e.client.usable) {
    // 죽은 연결은 넘겨줄 수 없다. 들어내면 drop 이 기다리는 쪽을 깨운다.
    drop(key, e);
    return;
  }
  // 넘겨줄 곳이 있으면 넘긴다. 못 넘겼으면 아래에서 유휴 시계를 건다.
  if (s.waiting.length && wake(key, e)) return;
  if (!e.idle) {
    e.idle = setTimeout(() => {
      // 기다리는 사이에 누가 다시 빌려 갔으면 그냥 둔다
      if (e.busy) return;
      evict(key, e);
    }, POOL_IDLE_MS);
    // 이 타이머 하나 때문에 프로세스가 안 죽으면 안 된다
    e.idle.unref?.();
  }
}

/**
 * 조각 하나를 받는 동안 쓸 연결.
 *
 * `long` 은 **연결을 오래 쥘 일인가**를 뜻한다. 첨부 스트림이 그렇다 —
 * 함수가 돌아온 뒤에도 바이트가 흐르는 동안 계속 쥔다.
 */
async function connect(
  account: Account,
  long: boolean,
): Promise<{ client: ImapFlow; release: () => void }> {
  const { folder } = parseImapView(account.query);
  const key = poolKey(account, folder);

  /*
   * 두 번까지 해 본다. 빌린 연결이 **빌리는 사이에** 죽는 일이 있다 —
   * 유휴 시계가 막 끝났거나 상대가 먼저 끊은 순간에 걸리면 그렇다. 그때
   * 요청을 실패로 돌리면 사람 화면에는 이유 없는 "이미지 없음" 이 남는다.
   */
  for (let attempt = 0; ; attempt++) {
    const held = await take(account, key, long);

    let lock;
    try {
      /*
       * 이제 한 연결에는 한 요청만 타므로 이 잠금은 다투지 않는다. 그래도
       * 부르는 이유는 폴더를 고르는 일이 이 잠금 안에서 일어나기 때문이다.
       */
      lock = await held.client.getMailboxLock(folder);
    } catch (e) {
      /*
       * **`giveBack` 을 부르면 안 된다.** 그것은 이 연결을 기다리는 쪽에
       * 곧장 넘겨 주는데, 바로 다음 줄에서 우리가 그 연결을 로그아웃시킨다 —
       * 넘겨받은 쪽은 이미 죽은 연결을 쥐게 된다. 잠금조차 못 잡은 연결이니
       * 그냥 들어내고 닫는다. `drop` 이 기다리는 쪽을 깨워, 그쪽이 새로 연다.
       */
      held.busy = false;
      held.long = false;
      evict(key, held);
      if (attempt >= 1) throw e;
      continue;
    }

    let done = false;
    return {
      client: held.client,
      release: () => {
        if (done) return;
        done = true;
        try {
          lock.release();
        } catch {
          /* 이미 끊긴 연결 */
        }
        giveBack(key, held);
      },
    };
  }
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
  const { client, release } = await connect(account, false);
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
  const { client, release } = await connect(account, true);
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
