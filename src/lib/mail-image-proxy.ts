import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest, type ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { apiPath } from "./api-path";
import { env } from "./env";
import { sniffImageType } from "./image-bytes";

/**
 * 본문의 원격 그림을 **서버가 대신 받아 온다.**
 *
 * 왜 — 브라우저가 `<img src="https://발신자/…">` 를 직접 부르면 발신자는 연 시각,
 * 읽는 사람의 IP, 브라우저 종류, 그리고 (주소에 심어 둔 식별자로) "누가" 열었는지를
 * 함께 얻는다. 서버가 대신 부르면 발신자가 보는 것은 우리 서버의 IP 뿐이다.
 *
 * 대가는 **우리 서버가 남이 시키는 주소를 부르게 된다**는 것이다(SSRF). 아래의
 * 방어가 그 대가를 치르는 부분이고, 하나라도 빠지면 이 프록시는 내부망을
 * 들여다보는 창이 된다.
 */

// ─────────────────────────────────────────────────────────────
//   1. 주소 서명 — 아무 주소나 부르는 열린 프록시가 되지 않게
// ─────────────────────────────────────────────────────────────

/**
 * 서명 키.
 *
 * ENCRYPTION_KEY 를 그대로 쓰지 않고 한 겹 파생한다 — 같은 키를 두 용도로
 * 직접 쓰면 한쪽의 실수가 다른 쪽으로 번진다. base64 로 풀지 않는 이유는
 * 여기서는 32바이트일 필요가 없고, 풀다 던지면 그림 하나 때문에 본문 전체가
 * 못 그려지기 때문이다.
 */
function signingKey(): Buffer {
  return createHmac("sha256", Buffer.from(env.ENCRYPTION_KEY, "utf8"))
    .update("mailbento:image-proxy:v1")
    .digest();
}

/** 128비트면 위조를 막기에 충분하고 주소가 짧다 (본문에 수십 개가 박힌다). */
function sign(url: string): string {
  return createHmac("sha256", signingKey())
    .update(url, "utf8")
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

export function verifyImageSignature(url: string, sig: string): boolean {
  const expected = Buffer.from(sign(url), "utf8");
  const got = Buffer.from(sig, "utf8");
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

/** 본문에 박아 두는 상한. 이보다 긴 주소는 그림을 버린다. */
const MAX_URL_LENGTH = 2000;

/**
 * 이 주소를 우리 라우트를 거쳐 받아 오는 주소로. 부를 수 없는 주소면 null.
 *
 * `apiPath()` 를 쓴다. 이 문자열은 서버가 만들지만 **브라우저가 읽는 값**이고,
 * 하위 경로 배포(`/mail` 아래)에서는 접두어가 붙어야 한다. 라우트끼리 오가는
 * 경로가 아니라 화면에 박히는 주소라서 api-path.ts 의 "서버에서는 필요 없다"가
 * 여기엔 해당하지 않는다.
 */
export function imageProxyPath(rawUrl: string): string | null {
  if (rawUrl.length > MAX_URL_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  // 주소에 박힌 자격증명은 우리가 대신 써 줄 것이 아니다
  if (u.username || u.password) return null;

  const url = u.toString();
  return apiPath(
    `/api/mail-image?u=${encodeURIComponent(url)}&s=${sign(url)}`,
  );
}

// ─────────────────────────────────────────────────────────────
//   2. 어디로는 나가지 않는가 — 이름이 아니라 **풀린 주소**를 본다
// ─────────────────────────────────────────────────────────────

function ipv4Bytes(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function inNet(b: number[], net: number[], prefix: number): boolean {
  let bits = prefix;
  for (let i = 0; i < b.length && bits > 0; i++) {
    const take = Math.min(8, bits);
    const mask = (0xff << (8 - take)) & 0xff;
    if ((b[i] & mask) !== (net[i] & mask)) return false;
    bits -= take;
  }
  return true;
}

/** IANA 특수 목적 대역 — 인터넷의 남에게는 갈 수 없는 주소들. */
const BLOCKED_V4: Array<[number[], number]> = [
  [[0, 0, 0, 0], 8], // "이 네트워크"
  [[10, 0, 0, 0], 8], // 사설
  [[100, 64, 0, 0], 10], // CGNAT
  [[127, 0, 0, 0], 8], // 루프백
  [[169, 254, 0, 0], 16], // 링크로컬 (클라우드 메타데이터가 여기 산다)
  [[172, 16, 0, 0], 12], // 사설
  [[192, 0, 0, 0], 24], // IETF 프로토콜 할당
  [[192, 0, 2, 0], 24], // 문서용
  [[192, 88, 99, 0], 24], // 6to4 릴레이
  [[192, 168, 0, 0], 16], // 사설
  [[198, 18, 0, 0], 15], // 벤치마크
  [[198, 51, 100, 0], 24], // 문서용
  [[203, 0, 113, 0], 24], // 문서용
  [[224, 0, 0, 0], 4], // 멀티캐스트
  [[240, 0, 0, 0], 4], // 예약 (255.255.255.255 포함)
];

/** IPv6 문자열 → 16바이트. 못 읽으면 null. */
function ipv6Bytes(ip: string): number[] | null {
  let s = ip.split("%")[0]; // 존 인덱스(fe80::1%eth0) 제거
  let tail: number[] = [];
  // 끝이 IPv4 표기(::ffff:1.2.3.4)면 떼어내 4바이트로
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    const b = ipv4Bytes(v4[1]);
    if (!b) return null;
    tail = b;
    s = s.slice(0, v4.index);
    if (s.endsWith(":") && !s.endsWith("::")) s = s.slice(0, -1);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toWords = (part: string): number[] | null => {
    if (!part) return [];
    const words: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      words.push(parseInt(g, 16));
    }
    return words;
  };
  const head = toWords(halves[0]);
  const rest = halves.length === 2 ? toWords(halves[1]) : [];
  if (head === null || rest === null) return null;

  const bytes: number[] = [];
  const push = (w: number) => bytes.push((w >> 8) & 0xff, w & 0xff);
  head.forEach(push);
  const fixed = head.length * 2 + rest.length * 2 + tail.length;
  if (halves.length === 2) {
    for (let i = fixed; i < 16; i++) bytes.push(0);
  }
  rest.forEach(push);
  bytes.push(...tail);
  return bytes.length === 16 ? bytes : null;
}

/**
 * 이 주소로 나가도 되나.
 *
 * **DNS 로 풀린 주소를 본다.** 이름만 봐서는 못 막는다 — `evil.example.com` 이
 * `127.0.0.1` 을 가리키게 하는 데는 아무 권한도 필요 없고, 실제로 그렇게 하는
 * 공개 도메인이 있다.
 */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const b = ipv4Bytes(ip);
    if (!b) return true;
    return BLOCKED_V4.some(([net, len]) => inNet(b, net, len));
  }
  if (v !== 6) return true;

  const b = ipv6Bytes(ip);
  if (!b) return true;

  // IPv4 를 품고 있는 표기들은 벗겨서 v4 규칙으로 다시 본다.
  const zeros = (from: number, to: number) =>
    b.slice(from, to).every((x) => x === 0);
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) {
    return isBlockedAddress(b.slice(12).join(".")); // ::ffff:0:0/96
  }
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return isBlockedAddress(b.slice(12).join(".")); // NAT64 64:ff9b::/96
  }
  if (b[0] === 0x20 && b[1] === 0x02) return true; // 6to4 2002::/16

  if (b.every((x) => x === 0)) return true; // ::
  if (zeros(0, 15) && b[15] === 1) return true; // ::1
  if (b[0] === 0xff) return true; // 멀티캐스트 ff00::/8
  if ((b[0] & 0xfe) === 0xfc) return true; // 유니크로컬 fc00::/7
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // 링크로컬 fe80::/10
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // 사이트로컬(폐기)
  if (b[0] === 0x01 && zeros(1, 8)) return true; // 100::/64 discard
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) {
    return true; // 2001:db8::/32 문서용
  }
  return false;
}

/**
 * 이름을 풀되, **연결에는 우리가 검사한 그 주소를 그대로 쓰게** 한다.
 *
 * 검사와 연결을 따로 하면 그 사이에 DNS 답이 바뀔 수 있다(rebinding). 소켓이
 * 쓰는 lookup 자체를 갈아끼우면 검사한 주소와 연결하는 주소가 같아진다.
 *
 * 답 중 하나라도 내부 주소면 통째로 거절한다. 공개 주소만 골라 써도 되지만,
 * 공개/내부가 섞인 답은 정상적인 호스트의 모습이 아니다.
 */
type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

function guardedLookup(
  hostname: string,
  options: { all?: boolean } | number,
  cb: LookupCb,
): void {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err, "", 4);
    if (!addrs.length) {
      return cb(new Error(`${hostname} 을(를) 찾을 수 없습니다`), "", 4);
    }
    for (const a of addrs) {
      if (isBlockedAddress(a.address)) {
        return cb(
          new Error(`내부 주소로는 나가지 않습니다 (${hostname})`),
          "",
          4,
        );
      }
    }
    if (typeof options === "object" && options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

// ─────────────────────────────────────────────────────────────
//   3. 실제로 받아 오기 — 크기·시간·리다이렉트 상한
// ─────────────────────────────────────────────────────────────

/** 본문의 그림 한 장에 이보다 더 쓸 이유가 없다. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 리다이렉트마다 주소를 다시 검사한다. 세 번이면 정상적인 CDN 은 다 닿는다. */
const MAX_REDIRECTS = 3;
/**
 * 한 장에 쓰는 **전체** 시간. 리다이렉트도, 줄 서서 기다린 시간도 다 든다.
 *
 * 앞에서는 이 값을 `socket.setTimeout` 으로 내려보냈는데, 그것은 **유휴**
 * 시간이라 바이트가 한 번 올 때마다 처음부터 다시 셌다. 실측:
 * `httpbin.org/drip?duration=40&numbytes=40` 이 **39,962ms** 만에 돌아왔다 —
 * 상한의 다섯 배다. 8초보다 촘촘히 몸통을 흘리기만 하면 얼마든지 붙들 수 있다.
 */
const TOTAL_TIMEOUT_MS = 8000;

/**
 * 소켓이 조용해도 되는 시간. 위의 전체 상한과 **다른 것**이다.
 * 죽은 상대를 8초까지 붙들고 있을 이유가 없어 따로 짧게 준다.
 */
const IDLE_TIMEOUT_MS = 4000;

/*
 * ───────────────────────── 자리(slot) 다시 짜기 ─────────────────────────
 *
 * 앞 판은 **상대별 상한 3** 이었다. 그것은 두 가지로 틀렸다.
 *
 * 1. **막으려던 것을 못 막았다.** 열쇠가 `url.host` — 공격자가 본문에 적는
 *    글자다. 와일드카드 DNS 한 줄(`*.evil.com`)이면 서버는 하나인데 열쇠는
 *    여섯이 되어 상한이 아예 안 걸린다. 실측(고치기 전, rig/dslot.ts):
 *    느린 서버 하나를 여섯 이름으로 부른 뒤 **다른 상대**의 정상 그림이
 *    7,7초.
 * 2. **대가가 컸다.** 그림을 한 CDN 에 몰아 둔 멀쩡한 뉴스레터가 6장이 아니라
 *    3장씩 나가게 되어, 20장이 3,252ms → 5,668ms 로 늘고 HTTP/2 로 한꺼번에
 *    들어오면 20장 중 5장이 8초 상한에 걸려 죽었다(전에는 0장).
 *
 * ── 무엇이 진짜 해를 끼치나 ──
 * 자리를 붙드는 것은 "장수" 가 아니라 **오래 붙들고 있는 것**이다. 빠른 상대는
 * 스무 장을 부르든 곧 비켜 준다. 그래서 상한을 장수가 아니라 **시간**으로
 * 건다:
 *
 *   갓 나간 요청(`SLOW_AFTER_MS` 안쪽)만 `MAX_CONCURRENT` 를 다툰다.
 *   그보다 오래 끄는 요청은 그 셈에서 **빠진다** — 대신 상대별 상한과
 *   전체 천장에만 걸린다.
 *
 * 그러면 이렇게 된다:
 *   · 빠른 CDN 은 아무것도 안 달라진다 — 느려질 틈이 없으니 늘 6장씩 나간다.
 *     (상대별 상한을 전체와 같은 6 으로 둔 것이 그래서다. 한 상대만 보면
 *      앞 판의 전역 상한 6 과 **똑같이** 움직인다.)
 *   · 느린 상대가 여섯 자리를 쥐고 있어도 1.2초 뒤에는 그 여섯이 셈에서
 *     빠져, 뒤에 온 **다른 상대**가 곧바로 나간다.
 *   · 눌러앉은 상대는 상대별 상한 6 에 걸려 더 못 늘린다.
 *
 * ── 열쇠 ──
 * 이름이 아니라 **풀린 주소**로 센다. 이름은 공격자가 적는 글자라 얼마든지
 * 늘릴 수 있지만 주소는 늘릴 수 없다. 주소는 이미 SSRF 검사가 푸는 것이라
 * DNS 를 한 번 더 부르지 않는다 — `guardedLookup` 이 답을 낸 그 자리에서
 * 열쇠만 바꿔 단다(`rekeySlot`). 처음에는 이름으로 잡고 있다가 첫 lookup 이
 * 끝나면 주소로 옮겨 간다. 잡을 때의 판정이 이름으로 이뤄지는 것은 상관없다
 * — 늦게 온 요청일수록 옳은 열쇠로 판정되고, 눌러앉기를 막는 것은 늦게 온
 * 요청 쪽이다.
 *
 * ── 값을 왜 이렇게 골랐나 ──
 * `SLOW_AFTER_MS` 는 "멀쩡한 CDN 한 장" 보다 넉넉히 커야 한다. 1.2초면 흔한
 * 히어로 이미지(0.8초)는 절대 안 걸리고, 걸릴 만큼 느린 상대는 어차피 사람이
 * 기다리는 중이다. `MAX_TOTAL` 은 메모리 천장이다 — 12 × 5MB = 60MB 가
 * 최악이고, 이것이 "굶기지 않기" 의 값이다. 앞 판의 30MB 보다 크지만, 그
 * 30MB 는 **다른 사람의 그림을 8초 죽이는 값으로 산 것**이었다.
 */

/** 갓 나간 요청(아직 안 느린 것)의 상한. 바로 이것이 burst 를 묶는다. */
const MAX_CONCURRENT = 6;

/**
 * 이보다 오래 끌면 "느린 것" 으로 보고 위 상한에서 뺀다.
 * 8초(총 상한)보다 한참 짧아야 뜻이 있다.
 */
const SLOW_AFTER_MS = 1200;

/**
 * 한 상대가 동시에 쥘 수 있는 수 — 느린 것까지 합쳐서.
 * `MAX_CONCURRENT` 와 **같게** 둔다: 상대가 하나뿐인 보통 메일에서는 앞 판의
 * 전역 상한과 똑같이 움직여야 하기 때문이다(그래야 대가가 0 이다).
 */
const MAX_PER_PEER = 6;

/** 느린 것까지 합친 전체 천장. 메모리와 소켓이 여기서 묶인다. */
const MAX_TOTAL = 12;

/** 자리 하나. 열쇠는 도중에 바뀔 수 있다(이름 → 풀린 주소). */
interface Lease {
  key: string;
  startedAt: number;
}

const inFlight = new Set<Lease>();
/** 상대별 지금 나가 있는 수. 0 이 되면 지운다(맵이 자라지 않게). */
const perPeer = new Map<string, number>();

interface Waiter {
  key: string;
  start: (l: Lease) => void;
}
const waiting: Waiter[] = [];

const loadOf = (key: string): number => perPeer.get(key) ?? 0;

/** 아직 안 느린 것의 수. 느려진 것은 여기서 빠진다 — 그것이 이 판의 요점이다. */
function activeCount(now: number): number {
  let n = 0;
  for (const l of inFlight) if (now - l.startedAt < SLOW_AFTER_MS) n++;
  return n;
}

function take(key: string, now: number): Lease {
  const lease: Lease = { key, startedAt: now };
  inFlight.add(lease);
  perPeer.set(key, loadOf(key) + 1);
  return lease;
}

function untake(l: Lease): void {
  const left = loadOf(l.key) - 1;
  if (left <= 0) perPeer.delete(l.key);
  else perPeer.set(l.key, left);
}

/**
 * **처음 보는 상대는 곧바로 내보낸다.**
 *
 * 지금 나가 있는 것이 하나도 없는 상대(`loadOf === 0`)는 `MAX_CONCURRENT` 를
 * 안 다투고 전체 천장에만 걸린다. 왜 — 굶는 것은 언제나 **뒤늦게 온 남의
 * 그림 한 장**이고, 그 한 장은 붙들고 있는 쪽과 아무 상관이 없기 때문이다.
 *
 * 이 줄이 없으면 느린 상대 여섯 장이 갓 나간 자리 여섯을 채운 동안(1.2초)
 * 남의 그림이 그대로 기다린다. 실측: 이 줄 없이 **994ms**, 있으면 **8ms**.
 * 천장(`MAX_TOTAL`)은 그대로라 늘어나는 부담은 없다.
 */
const mayStart = (key: string, now: number): boolean =>
  inFlight.size < MAX_TOTAL &&
  loadOf(key) < MAX_PER_PEER &&
  (activeCount(now) < MAX_CONCURRENT || loadOf(key) === 0);

/**
 * 기다리는 것 중 **가장 한가한 상대**를 고른다.
 *
 * 먼저 온 순서로만 깨우면(FIFO) 느린 상대가 줄을 통째로 쥐고 있는 동안 뒤에
 * 온 멀쩡한 그림이 계속 밀린다. 지금 나가 있는 수가 적은 상대부터 깨우면,
 * **처음 보는 상대는 자리가 나는 바로 그때 깨어난다.** 같은 부하끼리는 먼저
 * 온 것이 이긴다(배열 순서).
 */
function pickNext(now: number): Waiter | undefined {
  if (!waiting.length) return undefined;
  if (inFlight.size >= MAX_TOTAL) return undefined;
  const crowded = activeCount(now) >= MAX_CONCURRENT;
  let best = -1;
  let bestLoad = Infinity;
  for (let i = 0; i < waiting.length; i++) {
    const load = loadOf(waiting[i].key);
    if (load >= MAX_PER_PEER) continue;
    // 자리가 빡빡하면 **처음 보는 상대만** 지나간다 (위 mayStart 와 같은 규칙)
    if (crowded && load > 0) continue;
    if (load < bestLoad) {
      bestLoad = load;
      best = i;
      if (load === 0) break; // 이보다 한가할 수 없다
    }
  }
  return best < 0 ? undefined : waiting.splice(best, 1)[0];
}

/**
 * 시계 하나. **자리는 시간이 지나기만 해도 난다** — 나가 있는 요청이
 * `SLOW_AFTER_MS` 를 넘기는 순간 그것이 셈에서 빠지기 때문이다. 그래서
 * 반납만 기다리면 안 되고, 가장 이른 그 순간에 한 번 더 봐야 한다.
 */
let wakeTimer: NodeJS.Timeout | null = null;

function armTimer(now: number): void {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  if (!waiting.length) return;
  let soonest = Infinity;
  for (const l of inFlight) {
    const t = l.startedAt + SLOW_AFTER_MS;
    if (t > now && t < soonest) soonest = t;
  }
  if (soonest === Infinity) return;
  wakeTimer = setTimeout(
    () => {
      wakeTimer = null;
      pump();
    },
    soonest - now + 1,
  );
  // 이 시계 하나 때문에 프로세스가 안 죽으면 안 된다
  wakeTimer.unref?.();
}

/** 지금 내보낼 수 있는 만큼 내보낸다. */
function pump(): void {
  const now = Date.now();
  for (;;) {
    const w = pickNext(now);
    if (!w) break;
    /*
     * 자리를 **잡아서 넘긴다**. 깨워 놓고 스스로 찾게 하면, 깨어난 사이에
     * 다른 요청이 끼어들어 그 자리를 가로챈다.
     */
    w.start(take(w.key, now));
  }
  armTimer(now);
}

function releaseSlot(l: Lease): void {
  if (!inFlight.delete(l)) return; // 두 번 불려도 탈이 없게
  untake(l);
  pump();
}

/**
 * 이름으로 잡아 둔 자리를 **풀린 주소**로 옮겨 단다.
 *
 * 이미 잡은 자리를 놓지는 않는다 — 옮기다가 상한을 잠깐 넘길 수는 있지만,
 * 상한은 **새로 나가는 것**에 거는 것이라 그래도 된다. 옮기고 나면 그 주소의
 * 뒷 요청들이 비로소 한 열쇠로 세어진다.
 */
function rekeySlot(l: Lease, address: string): void {
  if (l.key === address) return;
  untake(l);
  l.key = address;
  perPeer.set(address, loadOf(address) + 1);
}

/** 자리가 날 때까지 기다린다. 기다린 시간도 그 그림의 8초에서 나간다. */
function acquireSlot(key: string, deadline: number): Promise<Lease> {
  const now = Date.now();
  if (mayStart(key, now)) return Promise.resolve(take(key, now));
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const entry: Waiter = {
      key,
      start: (l) => {
        clearTimeout(timer);
        resolve(l);
      },
    };
    timer = setTimeout(
      () => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        reject(new RemoteImageError("그림을 받는 데 너무 오래 걸립니다", 504));
      },
      Math.max(1, deadline - Date.now()),
    );
    waiting.push(entry);
    armTimer(now);
  });
}

export interface RemoteImage {
  /** 받아 온 바이트를 **직접 보고** 정한 타입. 발신자가 적은 값이 아니다. */
  contentType: string;
  body: Buffer;
}

export class RemoteImageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function once<T>(fn: (v: T) => void): (v: T) => void {
  let done = false;
  return (v: T) => {
    if (done) return;
    done = true;
    fn(v);
  };
}

interface HopResult {
  status: number;
  location: string | null;
  body: Buffer;
}

function getOnce(url: URL, deadline: number, lease: Lease): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";
    const send = secure ? httpsRequest : httpRequest;

    let req: ClientRequest | undefined;
    /*
     * **여기가 총 시간을 실제로 거는 자리다.**
     *
     * 아래 `timeout` 옵션은 소켓의 유휴 시간이라 몸통이 찔끔씩 오면 영영
     * 안 터진다. 벽시계로 재는 타이머를 따로 걸어 두고, 남은 시간이 다하면
     * 요청을 끊는다. 데이터가 오고 있어도 끊는다 — 그것이 요점이다.
     */
    let hardStop: NodeJS.Timeout | undefined;
    /** 응답을 **끝까지** 읽었나. 안 읽고 끝냈으면 소켓을 우리가 끊어야 한다. */
    let drained = false;
    const settle = once<{ ok?: HopResult; err?: Error }>((v) => {
      if (hardStop) clearTimeout(hardStop);
      /*
       * ── 끝낼 때는 **반드시** 요청도 끊는다 ──
       *
       * 앞에서는 실패(err)일 때만 destroy 했다. 그래서 3xx 갈래가 소켓을
       * 놓지 않았다: 그 갈래는 `res.resume()` 으로 몸통을 버리고 곧장 settle
       * 하면서 hardStop 을 지웠는데, 버려진 응답에는 총 시간도 유휴 시간도
       * 크기 상한도 아무것도 안 걸려 있었다. 상대가 몸통을 300ms 마다 영원히
       * 흘리면 소켓이 그대로 남는다 — 자리(slot)는 이미 반납된 뒤라
       * `MAX_CONCURRENT` 도 안 듣는다.
       *
       * 실측(고치기 전): 302 자기 자신을 한 번 → 502 로 끝나는데 연결 4개가
       * 남고 15초 뒤에도 그대로. 열 번 더 → 44개. Location 없는 302 를 30번
       * 동시에 → 30개가 20초 뒤에도 살아 있었다.
       *
       * `drained` 를 보는 이유: 정상 갈래는 `end` 까지 읽어 소켓이 이미 놀고
       * 있다. 그때까지 끊으면 keep-alive 로 다시 쓸 소켓을 공연히 버린다.
       */
      if (!drained) req?.destroy();
      if (v.err) reject(v.err);
      else resolve(v.ok as HopResult);
    });
    const settleErr = (e: Error) => settle({ err: e });
    hardStop = setTimeout(
      () => settleErr(new RemoteImageError("그림을 받는 데 너무 오래 걸립니다", 504)),
      Math.max(1, deadline - Date.now()),
    );

    try {
      req = send(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (secure ? 443 : 80),
          path: url.pathname + url.search,
          method: "GET",
          /*
           * SSRF 검사는 그대로다 — `guardedLookup` 이 하던 일을 한 글자도
           * 안 바꿨다. 답이 나온 **그 자리에서** 자리 열쇠만 주소로 갈아 단다.
           * DNS 를 한 번 더 부르지 않는다.
           */
          lookup: (hostname, options, cb) =>
            guardedLookup(hostname, options, (err, address, family) => {
              /*
               * **답은 문자열일 수도 배열일 수도 있다.**
               *
               * Node 24 는 이 훅을 `{ hints: 0, all: true }` 로 부른다
               * (`autoSelectFamily` 가 기본으로 켜져 있다). 그러면 `guardedLookup`
               * 이 콜백에 `[{ address, family }, …]` 를 넘긴다. 예전에는
               * `typeof address === "string"` 만 봐서 **이 줄이 한 번도 안 돌았고**,
               * 자리 열쇠가 공격자가 본문에 적는 이름 그대로 남아 있었다 —
               * 와일드카드 DNS 한 줄이면 같은 서버가 여러 열쇠가 된다.
               * 실측으로 잡혔다: 같은 주소를 이름 둘로 부르니 동시 12(6이어야 한다).
               */
              const first = Array.isArray(address) ? address[0]?.address : address;
              if (!err && typeof first === "string" && first) {
                rekeySlot(lease, first);
              }
              cb(err, address as never, family as never);
            }),
          headers: {
            /*
             * 보내지 **않는** 것이 요점이다 — Referer 도 Cookie 도 없다.
             * Referer 를 실으면 어느 메일을 보고 있는지가 발신자에게 가고,
             * 쿠키는 애초에 우리가 가진 것이 없다(node:http 는 저장소가 없다).
             */
            accept: "image/*",
            "user-agent": "MailBento image proxy",
            "accept-encoding": "identity",
          },
          // 소켓 유휴 상한. 총 시간은 위의 hardStop 이 따로 잰다.
          timeout: Math.max(
            1000,
            Math.min(IDLE_TIMEOUT_MS, deadline - Date.now()),
          ),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const location = res.headers.location ?? null;

          if (status >= 300 && status < 400) {
            /*
             * 몸통은 안 쓴다. **버리는 것(`resume`)으로는 모자라고 끊어야
             * 한다** — 흘려보내기만 하면 상대가 계속 보내는 한 소켓이 산다.
             * 위 settle 이 `drained` 가 아닌 것을 보고 요청을 destroy 한다.
             */
            res.destroy();
            return settle({ ok: { status, location, body: Buffer.alloc(0) } });
          }

          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX_IMAGE_BYTES) {
              res.destroy();
              settleErr(
                new RemoteImageError("그림이 너무 큽니다", 502),
              );
              return;
            }
            chunks.push(c);
          });
          res.on("end", () => {
            drained = true; // 끝까지 읽었다 — 소켓을 끊을 이유가 없다
            settle({
              ok: { status, location: null, body: Buffer.concat(chunks) },
            });
          });
          res.on("error", settleErr);
        },
      );
    } catch (e) {
      return settleErr(e instanceof Error ? e : new Error("요청 실패"));
    }

    req.on("error", settleErr);
    req.on("timeout", () => {
      req.destroy();
      settleErr(new RemoteImageError("그림을 받는 데 너무 오래 걸립니다", 504));
    });
    req.end();
  });
}

/**
 * 원격 그림 한 장을 받아 온다. 못 받거나 그림이 아니면 던진다.
 *
 * 디스크에 쓰지 않는다 — 상한(5MB)까지 메모리에 들고 있다가 응답으로 흘려보내고
 * 버린다. 앞머리를 봐야 정말 그림인지 알 수 있어서 스트리밍하지 않는다.
 *
 * 시간과 자리 둘 다 여기서 묶는다: 모든 홉과 기다린 시간을 합쳐
 * `deadline` 하나로 재고, 동시에 나가는 수는 자리(slot) 로 막는다.
 */
export async function fetchRemoteImage(rawUrl: string): Promise<RemoteImage> {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RemoteImageError("주소를 읽을 수 없습니다", 400);
  }

  /*
   * 자리는 **처음 부른 이름**으로 잡고, 첫 lookup 이 주소를 내주면 그 주소로
   * 옮겨 단다(`rekeySlot`). 리다이렉트로 상대가 바뀌어도 자리 하나는 그대로다
   * — 자리는 "이 요청 하나" 를 재는 것이지 홉을 재는 것이 아니다. 이제는
   * 열쇠가 바뀌어도 반납할 곳을 잃지 않는다: 반납은 이름이 아니라 **이 자리
   * 자체**(lease)로 한다.
   *
   * 포트는 열쇠에 안 넣는다. 붙들려 있는 것은 "그 기계" 이지 그 기계의 어느
   * 문이 아니고, 포트를 넣으면 공격자가 열쇠를 그만큼 더 늘릴 수 있다.
   */
  const lease = await acquireSlot(url.hostname, deadline);
  try {
    return await followAndFetch(url, deadline, lease);
  } finally {
    releaseSlot(lease);
  }
}

/** 리다이렉트를 따라가며 받는다. 자리를 잡은 채로 돌아야 해서 따로 둔다. */
async function followAndFetch(
  url: URL,
  deadline: number,
  lease: Lease,
): Promise<RemoteImage> {
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new RemoteImageError("http(s) 만 받아 옵니다", 400);
    }
    if (url.username || url.password) {
      throw new RemoteImageError("자격증명이 박힌 주소는 부르지 않습니다", 400);
    }
    /*
     * 주소에 이름이 아니라 **IP 가 직접 적혀 있으면** 아래의 lookup 검사가
     * 아예 안 돈다 — Node 의 net.connect 는 host 가 IP 리터럴이면 DNS 를
     * 건너뛴다(`isIP(host)` 분기). 그래서 `http://127.0.0.1/` 은 lookup 을
     * 아무리 단단히 막아도 그냥 나간다. 여기서 따로 본다.
     * (재 보고 알았다: 잡히는 줄 알았던 127.0.0.1 이 실제로는 연결까지 갔다.)
     */
    const literal = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
    if (isIP(literal) && isBlockedAddress(literal)) {
      throw new RemoteImageError("내부 주소로는 나가지 않습니다", 400);
    }
    if (Date.now() > deadline) {
      throw new RemoteImageError("그림을 받는 데 너무 오래 걸립니다", 504);
    }

    const res = await getOnce(url, deadline, lease);

    if (res.status >= 300 && res.status < 400 && res.location) {
      // 리다이렉트가 사설 주소를 가리키는 것이 SSRF 의 흔한 길이다. 다음 판에서
      // 프로토콜 검사와 lookup 검사를 **처음부터 다시** 받는다.
      try {
        url = new URL(res.location, url);
      } catch {
        throw new RemoteImageError("리다이렉트 주소가 이상합니다", 502);
      }
      continue;
    }
    if (res.status !== 200) {
      throw new RemoteImageError(`발신자 서버가 ${res.status}`, 502);
    }

    const contentType = sniffImageType(res.body);
    if (!contentType) {
      // 선언이 image/png 여도 내용이 그림이 아니면 안 내보낸다.
      throw new RemoteImageError("그림이 아닙니다", 415);
    }
    return { contentType, body: res.body };
  }

  throw new RemoteImageError("리다이렉트가 너무 많습니다", 502);
}
