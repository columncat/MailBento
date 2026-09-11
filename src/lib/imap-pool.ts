import type { ImapFlow } from "imapflow";

import type { Account } from "./db/schema";
import { basicCredsFromAccount, makeImapClient } from "./imap-client";
import { imapErrorDetail } from "./imap-error";

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
 *
 * ── 이 풀은 **한 벌뿐이다** ──
 * 첨부·인라인 그림뿐 아니라 **본문 열기**도 여기를 지난다. 본문 경로가 자기
 * 풀을 따로 두면 같은 계정에 연결이 두 배로 열려, 이 파일이 막으려던 바로 그
 * 한계(Gmail 계정당 동시 15)에 다시 부딪힌다. 그래서 `mail-part.ts` 가 아니라
 * 공용 자리에 있다.
 */
const POOL_IDLE_MS = 30_000;

/** 계정+폴더당 열어 두는 연결 수. */
const MAX_POOL_PER_KEY = 3;

/**
 * 그중 **오래 걸리는 일**(첨부 스트림 · 보관용 원문 전체 받기)이 한 번에
 * 쥘 수 있는 수. 나머지 하나는 언제나 짧은 일 몫으로 남는다.
 */
const MAX_LONG_PER_KEY = 2;

/** 자리가 나기를 기다리는 상한. 넘으면 60초를 그냥 기다리는 대신 끝낸다. */
const BORROW_TIMEOUT_MS = 15_000;

/** 자리를 못 잡았을 때 사람에게 보일 말. 부르는 쪽이 바꿔 넣을 수 있다. */
const BUSY_MESSAGE = "메일 서버가 바빠 조각을 못 받았습니다";

/*
 * ── 놀다가 반쯤 죽은 연결 ──
 *
 * 소켓은 살아 있는데 서버가 답을 안 하는 연결이 있다. 상대가 제대로 끊으면
 * (RST/FIN) `close` 가 와서 위에서 들어내는데, NAT 가 흐름 기록을 버리거나
 * 서버가 멎으면 **아무 일도 일어나지 않는다.** 그런 연결을 빌려 가면 다음
 * 명령이 `socketTimeout`(30초)을 꽉 채우고 실패한다.
 *
 * 이 고장은 **연결을 다시 쓰기 시작하면서 새로 생겼다.** 앞에서는 본문을 열
 * 때마다 새로 연결했으니 이 길이 없었다. `borrowImapConnection` 의 재시도는
 * `getMailboxLock` 실패만 잡는데, 이미 SELECT 된 메일함이면 그 줄이 왕복을
 * 한 번도 안 쓰고 지나가 버려 `fetchOne` 에서 멎는다(실측: 흉내 서버가 소켓을
 * 닫지 않고 답만 멈춘 뒤 5초 뒤 본문 열기 → **30,002ms 실패**. 같은 순서로
 * 옛 코드는 12ms 성공 — 그쪽은 열 때마다 새 연결이었다).
 *
 * 그래서 **놀던 연결은 건네기 전에 NOOP 으로 한 번 두드린다.** 답이 오면
 * 그대로 쓰고, 안 오면 그 자리에서 끊고 새로 연다. 같은 재현에서
 * 30,002ms 실패 → **5,034ms 성공**.
 */

/**
 * 이만큼 놀았던 연결만 두드린다.
 *
 * 왜 매번이 아닌가 — 두드리는 값이 왕복 하나다. 인라인 그림 여덟 장처럼
 * 잇달아 빌려 가는 자리에서는 그 왕복이 여덟 번 늘어난다. 그런데 방금
 * 답한 연결이 그 사이에 죽었을 확률은 사실상 없다. 이 고장은 **노는 동안**
 * 생긴다(풀에 최대 30초 머문다). 1초면 잇단 요청은 그냥 지나가고, 사람이
 * 메일을 읽다가 다음 통을 여는 자리는 전부 걸린다.
 */
const PROBE_AFTER_IDLE_MS = 1_000;

/**
 * 두드림에 줄 시간. 넘으면 죽은 것으로 본다.
 *
 * **5,000 이었다. 그 값이 흔한 길에서 매번 다 쓰였다.**
 *
 * 사연: 이 값을 5초로 잡을 때는 "드문 고장에서만 치르는 값" 이라고 봤다.
 * 그런데 아래 `open()` 이 적어 둔 대로, 풀에 15초 넘게 놀던 연결은 imapflow
 * 가 스스로 IDLE 에 들어간다. 그 상태에서 `noop()` 은 곧장 나가지 못하고
 * IDLE 을 깨는 절차 뒤에 줄을 서는데, 서버가 그 절차를 제때 안 끝내면
 * **NOOP 은 소켓에 한 글자도 안 나간 채** 이 상한이 다할 때까지 매달린다.
 * 사람이 메일 한 통 읽고 다음 통을 여는 리듬(15~30초)이 정확히 그 창이라,
 * 운영에서 열기마다 5초가 갔다(실측 중앙값 5,346ms).
 *
 * `disableAutoIdle` 로 그 창을 없앴으니 이제 두드림은 **왕복 하나**다. 왕복
 * 200ms 짜리 먼 서버라도 200~400ms 면 답이 온다. 1,500 은 그 네 배 위라
 * "잠깐 바쁜 서버를 죽었다고 오해" 할 여유가 넉넉하면서, 최악이 5초에서
 * 1.5초로 준다. (그래도 socketTimeout(30초)보다는 확실히 짧다 — 그게 이
 * 값의 존재 이유다.)
 */
const PROBE_TIMEOUT_MS = 1_500;

export class PartError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Pooled {
  client: ImapFlow;
  /** 지금 누가 쓰고 있나. **한 연결에 한 요청만** 태운다. */
  busy: boolean;
  /** 지금 쥔 쪽이 오래 걸리는 일인가 (반납할 때 셈을 되돌리려고 든다). */
  long: boolean;
  idle: NodeJS.Timeout | null;
  /**
   * 이 연결이 **마지막으로 답을 준** 때. 얼마나 놀았는지 재는 데 쓴다.
   * (`idle` 타이머의 시작 시각과는 다르다 — 그쪽은 언제 닫을지를 잰다.)
   */
  lastOkAt: number;
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

/** 로그에 쓸 짧은 이름. **자격 증명은 빼고** 계정과 폴더만. */
function keyLabel(key: string): string {
  const p = key.split(" ");
  return `account=${p[0]} folder=${p[4] ?? "?"}`;
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

/**
 * 들어내고 **곧장** 끊는다. 답을 안 하는 연결에 쓴다.
 *
 * `evict` 는 LOGOUT 을 보내고 그 답을 기다리는데, 벙어리가 된 연결에서는 그
 * 기다림이 또 30초다. 이미 못 믿기로 한 연결에 예의를 차릴 이유가 없다.
 */
function kill(key: string, e: Pooled): void {
  drop(key, e);
  try {
    e.client.close();
  } catch {
    /* 이미 끊긴 연결 */
  }
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
  /*
   * ── 풀에 든 연결에는 **자동 IDLE 을 끈다** ──
   *
   * imapflow 는 SELECTED 상태에서 15초를 놀면 스스로 `IDLE` 에 들어간다
   * (`imap-flow.js` 의 `autoidle()`). 그리고 한 번에 명령 하나만 와이어에
   * 올리므로, IDLE 중에 `noop()` 을 부르면 그 NOOP 은 **IDLE 을 깨는 절차
   * 뒤에 줄을 선다.** 그 절차는 서버가 `+` 를 줘야(또는 DONE 뒤 tagged OK 를
   * 줘야) 끝나는데, 안 주면 imapflow 안에는 상한이 없어 **NOOP 이 소켓에 한
   * 글자도 안 나간 채 매달린다.** 우리 `withTimeout` 이 유일한 마개다.
   * 실측(흉내 서버, RTT 50ms): 20초 논 뒤 열기 **5,564ms** — 운영 로그의
   * 중앙값 5,346ms 와 같은 서명이다. 3초만 논 연결은 127ms 였다.
   *
   * **이 고장은 앞 판 시험대가 못 잡았다.** 흉내 서버가 CAPABILITY 에 IDLE 을
   * 올려만 놓고 명령은 `BAD` 로 답해, autoidle 이 곧장 catch 로 떨어졌다.
   * 그래서 IDLE·DONE 길이 시험에서 **한 번도 안 돌았다.** (지금 시험대는
   * IDLE 을 제대로 받는다.)
   *
   * 끄면 무엇을 잃나 — **아무것도.** 우리는 IDLE 로 새 메일을 기다리지 않는다
   * (수집은 10분 타이머고 `exists`/`expunge` 를 듣는 곳이 없다). NAT 유지나
   * 서버의 유휴 연결 끊기도 상관없다 — 풀에 머무는 시간이 30초뿐이다.
   * 잃는 것 하나는 `socketTimeout` 이 IDLE 중인 연결을 되살리는 길인데,
   * 그 길은 되살리려고 부르는 NOOP 이 바로 위와 같은 자리에 걸려 **원래부터
   * 안 되는 길**이다(실측: 18분 뒤에도 매달려 있었다).
   *
   * 한 번 쓰고 버리는 연결(`withImapConnection`)은 15초를 놀 일이 없어
   * 이 손잡이가 필요 없다. 그래서 풀에서만 켠다.
   */
  const client = makeImapClient(basicCredsFromAccount(account), {
    disableAutoIdle: true,
  });
  /*
   * 상대가 먼저 끊는 일은 늘 있다(유휴 정리·서버 재시작). 그때 풀에 시체가
   * 남아 있으면 다음 요청이 그걸 빌려 갔다가 실패한다. 끊기는 즉시 들어낸다.
   * 'error' 를 안 받으면 소켓 오류가 unhandled 로 올라와 프로세스를 죽인다.
   */
  const entry: Pooled = {
    client,
    busy: false,
    long: false,
    idle: null,
    lastOkAt: Date.now(),
  };
  client.on("close", () => drop(key, entry));
  client.on("error", () => {});
  await client.connect();
  entry.lastOkAt = Date.now();
  return entry;
}

/** 약속에 시간 상한을 씌운다. 늦으면 던진다. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`두드림이 ${ms}ms 안에 안 끝났다`)),
      ms,
    );
    timer.unref?.();
    /*
     * `then` 의 두 자리를 다 채운다. 시간이 다한 뒤 늦게 오는 거절도 여기서
     * 받아 삼켜야 unhandled rejection 이 프로세스를 흔들지 않는다.
     */
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 놀던 연결을 건네도 되는지 두드려 본다. 답이 없으면 끊고 `false`.
 *
 * 이 함수를 부를 때 연결은 이미 `hold` 로 잡혀 있다 — 두드리는 동안 다른
 * 요청이 같은 연결을 가로채면 안 되기 때문이다. 그래서 버릴 때 잡아 둔 표시
 * (`busy`/`long`)를 손수 되돌린다.
 */
async function probe(key: string, e: Pooled): Promise<boolean> {
  if (Date.now() - e.lastOkAt < PROBE_AFTER_IDLE_MS) return true;
  const t0 = Date.now();
  try {
    await withTimeout(e.client.noop(), PROBE_TIMEOUT_MS);
    e.lastOkAt = Date.now();
    return true;
  } catch (err) {
    e.busy = false;
    e.long = false;
    kill(key, e);
    /*
     * ── 형제들도 함께 버린다 ──
     *
     * 이 고장은 한 소켓만 골라 덮치지 않는다. 노트북이 깨어나거나 NAT 가
     * 흐름 기록을 버리면 **같은 상대로 놀고 있던 연결이 한꺼번에** 벙어리가
     * 된다. 그것들을 하나씩 두드리면 5초가 사람 앞에서 차례로 쌓인다 —
     * 실측: 셋을 채운 풀이 통째로 벙어리가 된 뒤 본문 열기 **15,065ms**
     * (성공하기는 한다. 두드림이 없던 때는 30,014ms 실패였다).
     *
     * 그래서 하나가 죽은 것을 본 자리에서, **놀고 있던** 나머지도 두드리지
     * 않고 버린다. 같은 15초가 5,032ms 로 줄어든다.
     *
     * 쥐고 있는 연결(`busy`)은 건드리지 않는다. 그쪽은 지금 자기 일을 하는
     * 중이고, 정말 죽었다면 그 요청이 스스로 시간을 다한다. 남의 일이
     * 도는 중에 소켓을 닫아 버리면 잘린 본문이 나올 수 있다.
     *
     * 헛짚을 때 치르는 값은 로그인 몇 번이다. 그런데 **여기 걸리는 연결은
     * 1초 넘게 놀던 것뿐이고**, 그중 하나는 방금 죽은 것이 밝혀졌다.
     * 어차피 다음에 빌려 갈 때 두드려 버려질 것들을 미리 버리는 셈이다.
     */
    const s = pool.get(key);
    let siblings = 0;
    if (s) {
      for (const other of [...s.entries]) {
        if (other.busy) continue;
        if (Date.now() - other.lastOkAt < PROBE_AFTER_IDLE_MS) continue;
        kill(key, other);
        siblings++;
      }
    }
    /*
     * **한 줄이라도 남긴다.** 앞에서는 이 catch 가 오류를 안 받고 아무것도 안
     * 찍었다. 연결 하나를 끊고 놀던 형제들까지 버리는 일인데 흔적이 없었고,
     * 그래서 "열기마다 5초" 라는 고장이 로그에서 안 보였다 — 다음 사람이
     * `conn=` 값 24개를 모아 중앙값을 내야 겨우 짚이는 고장이 됐다.
     */
    console.warn(
      `[pool] 두드림 실패 ${Date.now() - t0}ms — 이 연결과 놀던 ${siblings}개를 버린다 ` +
        // 키를 통째로 찍지 않는다 — 안에 IMAP 사용자 이름이 들어 있다.
        `(${keyLabel(key)}) ${imapErrorDetail(err)}`,
    );
    return false;
  }
}

/** 빌릴 수 있을 때까지 기다린다. 시간이 다하면 던진다. */
function waitForSlot(
  key: string,
  long: boolean,
  deadline: number,
  busyMessage: string,
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
        reject(new PartError(busyMessage, 504));
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
  busyMessage: string,
  marks: BorrowMarks,
): Promise<Pooled> {
  const deadline = Date.now() + BORROW_TIMEOUT_MS;
  for (;;) {
    const s = slotOf(key);
    if (mayTake(s, long)) {
      /*
       * **가장 최근에 반납된 것부터** 고른다. 앞에서는 `find` 라 배열 맨 앞,
       * 곧 **가장 오래 논 것**을 골랐다 — 두드림에 가장 잘 걸리는 쪽이다.
       * 방금 답한 연결을 먼저 쓰면 `PROBE_AFTER_IDLE_MS` 안에 들어 두드림을
       * 통째로 건너뛴다. 공짜로 왕복 하나가 준다.
       */
      let free: Pooled | undefined;
      for (const e of s.entries) {
        if (e.busy || !e.client.usable) continue;
        if (!free || e.lastOkAt > free.lastOkAt) free = e;
      }
      if (free) {
        const held = hold(free, long);
        const p0 = Date.now();
        // 살아 있으면 그대로 쓴다. 아니면 방금 끊었으니 위에서 다시 본다.
        const alive = await probe(key, held);
        marks.probe += Date.now() - p0;
        if (alive) return held;
        continue;
      }
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
        const o0 = Date.now();
        try {
          const e = await open(account, key);
          marks.open += Date.now() - o0;
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
    const w0 = Date.now();
    const given = await waitForSlot(key, long, deadline, busyMessage);
    marks.wait += Date.now() - w0;
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
  /*
   * 여기까지 왔다는 것은 이 연결이 방금까지 답을 했다는 뜻이다. 놀기
   * 시작하는 시각을 여기서 찍어 둔다 — 다음에 빌려 갈 쪽이 이 값을 보고
   * 두드릴지 말지 정한다.
   */
  e.lastOkAt = Date.now();
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
 * 연결 하나를 빌리는 데 **어디에** 시간이 갔나. 부르는 쪽이 로그에 쪼개 적는다.
 *
 * 왜 필요한가 — 앞에서는 본문 로그의 `conn=5491ms` 가 숫자 하나였고, 그 안에
 * 자리 기다림(최대 15초) · 두드림(최대 상한) · 새 LOGIN · SELECT 가 전부
 * 뭉개져 있었다. 그래서 "열기마다 5초" 를 짚는 데 값 24개와 중앙값이 필요했다.
 * 다음에는 한 줄로 끝나야 한다.
 */
export interface BorrowMarks {
  /** 자리가 나기를 기다린 시간. */
  wait: number;
  /** 놀던 연결을 두드리는 데 쓴 시간(실패해 버린 것까지 합친다). */
  probe: number;
  /** 새로 연 시간 (TCP+TLS+LOGIN…). 다시 쓴 연결이면 0. */
  open: number;
  /** `getMailboxLock` — 찬 연결이면 LIST+SELECT 가 여기 든다. */
  lock: number;
}

export interface BorrowOptions {
  /**
   * **연결을 오래 쥘 일인가.** 첨부 스트림이 그렇다 — 함수가 돌아온 뒤에도
   * 바이트가 흐르는 동안 계속 쥔다. 보관용으로 원문을 통째로 받는 것도 같다.
   *
   * 본문 열기는 `false` 다. 왜 — 사람은 메일을 한 번에 한 통 연다(모달이
   * 하나다). 반면 인라인 그림은 본문이 도착한 **뒤에** 여덟 장이 한꺼번에
   * 날아온다. 둘은 사실상 겹치지 않는다. 그런데 본문 열기를 `long` 으로 세면
   * 첨부 두 개가 흐르는 동안 메일을 못 여는(15초 뒤 504) 일이 생긴다 —
   * 짧은 일 몫으로 남겨 둔 자리 하나가 정확히 이런 때를 위한 것이다.
   */
  long: boolean;
  /** 자리를 못 잡았을 때의 말. 안 넘기면 조각 기준의 기본 문구. */
  busyMessage?: string;
}

/**
 * 일 하나를 하는 동안 쓸 IMAP 연결. 잡은 것은 반드시 `release()` 로 돌려준다.
 *
 * 폴더를 인자로 받는다(뷰의 query 에서 뽑지 않는다) — 그래야 이 파일이
 * `providers/imap.ts` 를 부르지 않고, 두 모듈이 서로를 무는 일이 없다.
 */
export async function borrowImapConnection(
  account: Account,
  folder: string,
  opts: BorrowOptions,
): Promise<{ client: ImapFlow; release: () => void; marks: BorrowMarks }> {
  const key = poolKey(account, folder);
  const long = opts.long;
  const busyMessage = opts.busyMessage ?? BUSY_MESSAGE;
  const marks: BorrowMarks = { wait: 0, probe: 0, open: 0, lock: 0 };

  /*
   * 두 번까지 해 본다. 빌린 연결이 **빌리는 사이에** 죽는 일이 있다 —
   * 유휴 시계가 막 끝났거나 상대가 먼저 끊은 순간에 걸리면 그렇다. 그때
   * 요청을 실패로 돌리면 사람 화면에는 이유 없는 "이미지 없음" 이 남는다.
   */
  for (let attempt = 0; ; attempt++) {
    const held = await take(account, key, long, busyMessage, marks);

    let lock;
    const l0 = Date.now();
    try {
      /*
       * 이제 한 연결에는 한 요청만 타므로 이 잠금은 다투지 않는다. 그래도
       * 부르는 이유는 폴더를 고르는 일이 이 잠금 안에서 일어나기 때문이다.
       * (이미 그 메일함이 열려 있으면 imapflow 가 SELECT 를 건너뛴다 —
       * 데워진 연결에서 이 줄이 왕복을 한 번도 안 쓰는 이유다.)
       */
      lock = await held.client.getMailboxLock(folder);
      marks.lock += Date.now() - l0;
    } catch (e) {
      marks.lock += Date.now() - l0;
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
      marks,
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
