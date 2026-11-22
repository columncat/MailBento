/**
 * 로그인 시도 제한.
 *
 * `/api/login`(JSON) 과 화면의 서버 액션(`login/actions.ts`) 이 같은 통을 쓴다.
 * JSON 입구는 스크립트로 두드리기 쉽고, 서버 액션도 액션 ID 만 알면 똑같이 두드릴 수 있다. 실패마다
 * 700ms 를 재우는 것만으로는 부족하다 — **동시에** 던지면 지연이 겹쳐서 사라진다.
 * 초당 수백 번이 가능해지고, 그러면 짧은 비밀번호는 금방 뚫린다.
 *
 * 그래서 지연이 아니라 **횟수**로 막는다. 창 안에서 정해진 횟수를 넘기면 그
 * 창이 끝날 때까지 전부 거절한다. 동시 요청도 같은 카운터를 지나므로 병렬로
 * 우회할 수 없다.
 *
 * 프로세스 메모리에 둔다. 단일 컨테이너이고, 재시작하면 풀리는 편이 잠금에
 * 갇히는 것보다 낫다 — 이건 한 사람이 쓰는 앱이다.
 */

/** 창 길이. */
const WINDOW_MS = 10 * 60 * 1000;
/** 창 안에서 허용할 실패 횟수. */
const MAX_FAILS = 10;

interface Bucket {
  fails: number;
  /** 창이 끝나는 시각. */
  until: number;
}

/*
 * 통은 모듈 변수가 아니라 `globalThis` 에 둔다.
 *
 * Next 는 라우트마다 서버 번들을 따로 만들고, 번들마다 모듈을 따로 올린다.
 * 모듈 변수로 두면 `/api/login` 과 화면 로그인(`login/page` 의 서버 액션)이
 * **서로 다른 Map** 을 들고, 한쪽에서 막혀도 다른 쪽으로 10번을 더 시도할 수
 * 있었다(실제로 그렇게 동작하는 것을 확인했다). 프로세스에 하나뿐인 자리에
 * 걸어 두어야 두 입구가 같은 횟수를 센다.
 */
const BUCKETS_KEY = Symbol.for("mailbento.login-throttle.buckets");
const g = globalThis as typeof globalThis & { [BUCKETS_KEY]?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g[BUCKETS_KEY] ??= new Map<string, Bucket>());

/**
 * 시도한 쪽을 가르는 열쇠.
 *
 * 예전에는 `X-Forwarded-For` 의 **첫** 칸을 썼다. 그 칸은 클라이언트가 적어 보낸
 * 값이 그대로 남는 자리라(Cloudflare 는 받은 XFF 뒤에 덧붙일 뿐이다), 요청마다
 * 다른 주소를 적으면 매번 새 통을 받아 횟수 제한이 통째로 무력해졌다.
 *
 * 이제 순서는 이렇다.
 *  1. `cf-connecting-ip` — Cloudflare 가 클라이언트 값을 **덮어쓴다.** 앱이 loopback
 *     에만 묶이면 이 헤더를 붙여 들어올 수 있는 것은 cloudflared 뿐이다.
 *  2. `x-real-ip` — 다른 앞단 프록시를 쓰는 배포.
 *  3. `x-forwarded-for` 의 **마지막** 칸 — 바로 앞 프록시가 적은 값이라 클라이언트가
 *     고를 수 없다.
 *  4. 아무것도 없으면 하나로 묶는다 — 주소를 못 가르는 상황에서 전부 한 통에
 *     넣는 편이 안전하다.
 */
function keyOfHeaders(h: Pick<Headers, "get">): string {
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return hops[hops.length - 1] ?? "unknown";
}

/**
 * `Request` 든 `headers()` 가 준 것이든 받는다.
 *
 * 화면 로그인은 서버 액션이라 `Request` 가 없고 `next/headers` 의 읽기 전용
 * 헤더만 있다. 두 입구가 같은 통을 써야 하므로(한쪽만 막으면 다른 쪽으로
 * 돌아가면 그만이다) 열쇠 계산은 하나로 둔다.
 */
type Source = Request | Pick<Headers, "get">;

function keyOf(src: Source): string {
  /*
   * `.get` 이 있느냐로 가른다. `"headers" in src` 로 가르면 안 된다 — Next 의
   * 읽기 전용 헤더(HeadersAdapter)는 원본을 `this.headers` 에 들고 있어서
   * Request 로 오인되고, 화면 로그인이 `a.get is not a function` 으로 500 이 났다.
   * instanceof 도 쓰지 않는다 — 그 어댑터가 Headers 를 상속한다는 보장이 없다.
   */
  return keyOfHeaders(typeof (src as Partial<Headers>).get === "function"
    ? (src as Pick<Headers, "get">)
    : (src as Request).headers);
}

/** 지금 이 요청을 받아도 되는지. 막혔으면 남은 초. */
export function checkLoginAllowed(src: Source): { ok: true } | { ok: false; retryAfter: number } {
  const k = keyOf(src);
  const b = buckets.get(k);
  if (!b) return { ok: true };
  if (Date.now() >= b.until) {
    buckets.delete(k);
    return { ok: true };
  }
  if (b.fails < MAX_FAILS) return { ok: true };
  return { ok: false, retryAfter: Math.ceil((b.until - Date.now()) / 1000) };
}

export function noteLoginFailure(src: Source): void {
  const k = keyOf(src);
  const now = Date.now();
  const b = buckets.get(k);
  if (!b || now >= b.until) {
    buckets.set(k, { fails: 1, until: now + WINDOW_MS });
    return;
  }
  b.fails += 1;
}

/** 성공하면 창을 지운다. 옳은 비밀번호를 아는 쪽을 계속 막을 이유가 없다. */
export function noteLoginSuccess(src: Source): void {
  buckets.delete(keyOf(src));
}

/**
 * 실패에 딸리는 지연. 두 입구(JSON·서버 액션)가 같은 값을 쓴다.
 * 완전한 방어는 아니지만 초당 시도 횟수를 눈에 띄게 깎는다 — 횟수 제한이 본체다.
 */
export const FAIL_DELAY_MS = 700;
