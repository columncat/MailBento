import sanitizeHtml from "sanitize-html";

/**
 * 메일 HTML 본문을 안전하게 정제하고, **그림이 발신자 서버를 직접 부르지 못하게**
 * 주소를 우리 것으로 바꾼다.
 *
 * 정책:
 * - 일반적인 텍스트/문단/리스트/링크/이미지/표 허용
 * - 모든 script, on* 핸들러 제거
 * - 외부 링크는 target=_blank + rel=noopener
 * - 인라인 스타일은 일부 안전한 속성만 허용
 * - `img` 의 원격 주소는 서버가 대신 받아 오는 주소로, `cid:` 는 그 메일의
 *   인라인 조각을 내주는 주소로 바꾼다
 * - 추적 픽셀은 **주소를 바꾸지 않고 태그째 버린다** — 우리 서버도 안 부른다
 *
 * ── 요청이 나갈 수 있는 자리는 `img` 하나뿐이다 ──
 * allowedTags 에 iframe·video·audio·object·link·script 가 없고, `<style>` 블록은
 * sanitize-html 의 nonTextTags 기본값이 **내용째** 지운다. allowedStyles 에
 * `background-image` 가 없어 `url(...)` 도 통째로 사라진다. 그래서 아래 img
 * 변환 하나만 지키면 본문에서 밖으로 나가는 길이 닫힌다.
 */

/** 인라인(cid:) 그림을 무엇으로 바꿀지. */
export type InlineImageMode =
  /** 우리 라우트를 가리키게 한다. 화면용 — 본문이 가볍고 캐시를 탄다. */
  | "link"
  /** `data:` 로 본문에 굽는다. 보관용 — 원본이 서버에서 사라져도 열린다. */
  | "embed";

export interface EmailImagePolicy {
  /**
   * `cid:` 가 가리키는 조각을 무엇으로 바꿀지. null 이면 그 `img` 를 버린다
   * (가리키는 조각이 메일에 없거나, 굽기 예산을 넘었을 때).
   */
  resolveCid(cid: string): string | null;
  /** `http(s)` 주소를 서버가 대신 받아 오는 주소로. null 이면 버린다. */
  proxyRemote(url: string): string | null;
}

export interface SanitizedEmail {
  html: string;
  /**
   * 요청조차 보내지 않고 버린 추적 픽셀 수.
   * 브라우저도 우리 서버도 그 주소를 부르지 않았다는 뜻이다.
   */
  blockedTrackers: number;
  /** 서버가 대신 받아 오도록 주소를 바꾼 원격 그림 수. */
  proxiedImages: number;
  /** 본문이 실제로 쓴 cid 들. 첨부 목록에서 이것들을 뺀다. */
  usedCids: Set<string>;
}

/**
 * 버릴 `img` — **이름을 바꾸지 않고** 속성을 통째로 비운다.
 * 아래 `exclusiveFilter` 가 `src` 없는 img 를 결과에서 들어낸다.
 *
 * 예전에는 allowedTags 에 없는 이름("mb-dropped-img")으로 바꿔 통째로
 * 버리게 했는데, **그 길이 뒤따르는 형제의 닫는 태그를 망가뜨렸다.**
 * sanitize-html 의 onclosetag 는 버리는 태그에서 `transformMap[depth]` 를
 * 지우기 전에 빠져나간다(index.js: `if (skip) { … return; }` 가
 * `delete transformMap[depth]` 앞에 있다). 그 찌꺼기를 같은 깊이의 다음
 * 형제가 물려받아, 예컨대
 *   `<img 픽셀><table>…</table>`  →  `<table>…</tr></mb-dropped-img>`
 * 처럼 `</table>` 이 통째로 사라졌다. 추적 픽셀은 뉴스레터 맨 위에 놓이는
 * 일이 많아 본문 구조가 실제로 깨졌다.
 *
 * 이름을 안 바꾸면 transformMap 에 아무것도 안 남아 그 길 자체가 없다.
 * `src` 를 비운 `<img>` 가 화면에 남지도 않는다 — exclusiveFilter 가
 * 여는 태그까지 잘라내므로 깨진 그림 자리도 안 생긴다.
 */
const DROP = { tagName: "img", attribs: {} } as const;

/*
 * ── 표기를 바꾸는 것만으로 판정을 뒤집을 수 없게 ──
 *
 * 아래 것들(이스케이프 풀기 · 선언 쪼개기 · **선언 접기** · 값의 유효성 ·
 * 길이 읽기)은 **브라우저가 실제로 하는 대로**를 따라간다. 규칙을 지어내지
 * 않고 Chrome 에 같은 값을 넣어 확인한 뒤에 적었다 — 확인한 것들은 각 함수의
 * 주석에 남겼다.
 *
 * 왜 이렇게까지 하나: 이 판정이 틀리면 "숨긴 그림"이 "보이는 그림"으로
 * 지나가고, 그때는 우리가 발신자를 대신 불러 준다. 표기 하나 바꾸는 것으로
 * 뚫린다면 문턱을 아무리 높여도 뜻이 없다.
 *
 * **틀리는 방향이 둘이라는 것이 요점이다.** 헐거우면 숨긴 픽셀이 지나가고,
 * 빡빡하면 멀쩡한 그림을 막는다. 그래서 고칠 때마다 양쪽을 함께 잰다 —
 * 우회 목록(rig/mutate2.ts, 바탕 29 × 변형 20)과 잘못 막기(rig/fp.ts 24건 ·
 * rig/corpus.ts 99건)를 같이 돌린다.
 */

/** CSS 이스케이프 — `\64 ` 같은 16진 표기와 `\t` 같은 문자 표기 둘 다. */
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([\s\S]))/g;

/**
 * CSS 식별자의 이스케이프를 푼다.
 *
 * 실측(Chrome): `\64 isplay:none` · `\0064 isplay:none` · `\64isplay:none` ·
 * `di\73 play:none` · `\64\69\73\70\6c\61\79:none` · `wid\th:1px` 이 전부
 * `display`/`width` 로 읽힌다. 이걸 안 풀면 숨긴 픽셀이 그냥 지나간다.
 */
function cssUnescape(s: string): string {
  if (!s.includes("\\")) return s;
  return s.replace(CSS_ESCAPE, (_, hex: string | undefined, ch?: string) => {
    if (hex === undefined) return ch ?? "";
    const cp = Number.parseInt(hex, 16);
    // 0 · 대리쌍 · 범위 밖은 CSS 가 U+FFFD 로 바꾼다
    if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
    return String.fromCodePoint(cp);
  });
}

/**
 * CSS 가 공백으로 치는 다섯 글자. **여기 없는 것은 공백이 아니다.**
 *
 * JS `.trim()` 은 NBSP(U+00A0)·BOM(U+FEFF)·U+2028 까지 벗기는데 CSS 는 그것들을
 * 이름/값의 **일부**로 읽고, 그러면 선언이 통째로 무효가 된다. 실측(Chrome):
 * `&nbsp;display:none` · `display:&nbsp;none` · `display:none&nbsp;` ·
 * `&#xFEFF;display:none` · ` display:none` · `dis&nbsp;play:none` ·
 * `width:&nbsp;1px` 이 **전부 40×20 으로 그대로 보인다.** `.trim()` 으로 벗기면
 * 우리만 `display:none` 으로 읽어 **멀쩡한 그림을 막고 추적 픽셀로 센다.**
 */
const CSS_WS = " \t\n\r\f";

/** CSS 공백만 앞뒤에서 벗긴다. */
function cssTrim(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && CSS_WS.includes(s[a])) a++;
  while (b > a && CSS_WS.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

/** 값을 최상위(괄호·따옴표 밖) CSS 공백으로 토큰내기. */
function cssTokens(v: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (quote) {
      buf += c;
      if (c === "\\" && i + 1 < v.length) buf += v[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\\" && i + 1 < v.length) {
      buf += c + v[++i];
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && depth > 0) {
      /*
       * 함수를 닫는 `)` 는 **거기서 토큰이 끝난다.** CSS 토크나이저가
       * `translate(1px)scale(2)` 를 두 함수 토큰으로 읽기 때문이다 — 사이의
       * 공백은 있어도 되고 없어도 된다(실측: 그 값이 유효하다). 앞서는 공백만
       * 보고 갈라서 이런 값을 한 덩이로 읽고 **무효로 판정했다.** 그러면
       * `transform:scale(0);transform:translate(1px)scale(2)` 에서 앞의
       * `scale(0)` 이 살아남아 **멀쩡한 그림을 막는다** — 값을 줄이는 도구가
       * 함수 사이 공백을 지우는 일이 흔해 실제로 만나는 꼴이다.
       */
      depth--;
      buf += c;
      if (depth === 0) {
        out.push(buf);
        buf = "";
        continue;
      }
      continue;
    } else if (depth === 0 && CSS_WS.includes(c)) {
      if (buf) out.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * "있긴 있는데 우리가 못 읽는다" 는 자리표.
 *
 * `width:50%` 처럼 **CSS 에는 어엿이 유효한데 우리가 픽셀로 못 옮기는** 값과,
 * `display:var(--바깥것)` 처럼 바깥을 알아야 풀리는 값이 여기 온다. 값이 없는
 * 것(`undefined`)과 **반드시 구별해야 한다** — 없으면 HTML 속성으로 되돌아가고,
 * 못 읽는 것이면 되돌아가면 안 된다(아래 `sideOf` 주석).
 */
const UNREADABLE = "!unreadable";

/** 전역 키워드. 값은 유효하지만 **무엇이 되는지는 바깥을 봐야 안다.** */
const GLOBAL_KEYWORDS = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

interface Declaration {
  /** 소문자·이스케이프 푼 이름. 사용자 정의 속성(`--x`)은 대소문자 그대로. */
  prop: string;
  /** `!important` 를 뗀 뒤의 원문 값. */
  raw: string;
  important: boolean;
}

/**
 * **같은 상자를 다른 이름으로 정하는 속성.** 한 열쇠로 모은다.
 *
 * 벤더 접두사와 같은 종류의 구멍이다 — 이름 하나만 바꿔 적으면 크기 판정을
 * 통째로 비껴간다. 실측(Chrome): `inline-size:1px;block-size:1px` 은 **1×1**,
 * `max-inline-size:0` 은 **0×0**, `-webkit-logical-width:1px` 도 **1×1** 로
 * 그려진다. 모으기 전에는 이 셋이 전부 그냥 지나갔다(rig/hunt2.ts).
 * 값 문법도 `width`/`max-width` 와 같다 — `CSS.supports` 로 확인했다
 * (`auto`·`min-content`·`fit-content`·`stretch`·`50%` 는 받고 `5`·`zzz` 는
 * 안 받는다).
 *
 * 접두사를 뗀 뒤에 모으므로 `-webkit-logical-width` 는 `logical-width` 로 온다.
 *
 * ── 왜 여기서(파싱 때) 모으는가 ──
 * 캐스케이드가 이름이 아니라 **적힌 차례**로 갈리기 때문이다. 실측:
 *   `width:1px;inline-size:600px` → 600px  (뒤엣것이 이긴다)
 *   `inline-size:600px;width:1px` → 1px
 * 한 열쇠로 모아 두면 아래 parseInlineStyle 의 캐스케이드가 저절로 맞는다.
 * 따로 읽어 뒤에서 `smaller` 로 견주면 차례를 잃어, 앞의 것처럼 **멀쩡한
 * 600px 그림을 1px 로 오해해 막는다.**
 *
 * ── 세로쓰기 ──
 * `writing-mode:vertical-rl` 에서 `inline-size` 는 높이가 된다. 우리는
 * writing-mode 를 못 보지만 **판정은 달라지지 않는다** — 두 변에 같은 문턱을
 * 쓰기 때문이다. 실측: `writing-mode:vertical-rl;inline-size:1px` 은 2×1 이라
 * 어느 쪽으로 읽어도 가는 변 하나가 1px 이다.
 */
const PROP_ALIAS: Record<string, string> = {
  "inline-size": "width",
  "block-size": "height",
  "max-inline-size": "max-width",
  "max-block-size": "max-height",
  // 접두사를 뗀 뒤의 옛 이름 (`-webkit-logical-width` 등)
  "logical-width": "width",
  "logical-height": "height",
  "max-logical-width": "max-width",
  "max-logical-height": "max-height",
};

/**
 * `style="a:b;c:d"` → 선언 목록.
 *
 * **`split(";")` 로는 안 된다.** CSS 에서 `;` 는 주석·따옴표·괄호 안에서는
 * 구분자가 아니다. 실측(Chrome) — 넷 다 display:none 으로 읽힌다:
 *   style="[주석]display:none"              ([주석] 안에 `;` 하나)
 *   style="color:red;[주석]display:none"    ([주석] 안에 ` ; `)
 *   style="font-family:'a;b';display:none"
 *   style="background:url(x;y);display:none"
 * 앞의 방식은 이 넷을 전부 엉뚱한 자리에서 잘라, 숨긴 선언을 못 봤다.
 *
 * 주석은 지우지 않고 **공백 한 칸으로** 바꾼다 — CSS 에서 주석은 토큰을
 * 가르기 때문이다(`di`+[주석]+`splay` 는 `display` 가 아니다).
 */
function splitDeclarations(style: string): Declaration[] {
  const chunks: string[] = [];
  let buf = "";
  let depth = 0; // 괄호 깊이. url(a;b) 안의 `;` 는 선언을 안 나눈다
  let quote: string | null = null;

  for (let i = 0; i < style.length; i++) {
    const c = style[i];
    if (quote) {
      buf += c;
      if (c === "\\" && i + 1 < style.length) buf += style[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\\" && i + 1 < style.length) {
      buf += c + style[++i];
      continue;
    }
    if (c === "/" && style[i + 1] === "*") {
      const end = style.indexOf("*/", i + 2);
      i = end < 0 ? style.length : end + 1;
      buf += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      chunks.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  chunks.push(buf);

  const out: Declaration[] = [];
  for (const decl of chunks) {
    // 이름과 값을 가르는 `:` 도 괄호·따옴표 밖의 것이어야 한다
    let d = 0;
    let q: string | null = null;
    let at = -1;
    for (let i = 0; i < decl.length && at < 0; i++) {
      const c = decl[i];
      if (q) {
        if (c === "\\") i++;
        else if (c === q) q = null;
      } else if (c === "\\") i++;
      else if (c === '"' || c === "'") q = c;
      else if (c === "(") d++;
      else if (c === ")") d = Math.max(0, d - 1);
      else if (c === ":" && d === 0) at = i;
    }
    if (at < 0) continue;

    const name = cssTrim(cssUnescape(decl.slice(0, at)));
    if (!name) continue;
    const custom = name.startsWith("--");
    // 벤더 접두사는 **이름만 다른 같은 속성**이다. 실측: `-webkit-transform:
    // scale(0)` 은 0×0 으로, `-webkit-filter:opacity(0)` 은 투명하게 그려진다.
    // 접두사를 안 떼면 이름 한 조각 붙이는 것만으로 판정이 뒤집힌다.
    const bare = custom
      ? name
      : name.toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, "");
    const prop = custom ? bare : (PROP_ALIAS[bare] ?? bare);

    // `!important` — 실측(Chrome): `display:none ! important` 처럼 사이가
    // 벌어져도 듣는다. 공백은 여기서도 CSS 것 다섯뿐이다.
    let raw = cssTrim(decl.slice(at + 1));
    let important = false;
    const bang = /![ \t\n\r\f]*important$/i.exec(raw);
    if (bang) {
      important = true;
      raw = cssTrim(raw.slice(0, bang.index));
    }
    out.push({ prop, raw, important });
  }
  return out;
}

/**
 * 값 안에 `var(` 가 있나 (대소문자 무관).
 *
 * 이름과 `(` 사이는 벌어질 수 없다 — CSS 는 이름 바로 뒤에 붙은 `(` 만
 * 함수로 읽는다. 실측(Chrome): `--a:none;display:var (--a)` 는 선언이 통째로
 * 무효가 되어 그림이 그대로 보인다. 공백을 받아 주면 우리만 `none` 으로 읽어
 * **멀쩡한 그림을 막는다.**
 */
/**
 * **임의 치환 함수**가 들었나 — `var()`·`attr()`·`env()`.
 *
 * 셋은 파싱 때는 무조건 유효하고, 값이 무엇이 될지는 계산할 때 정해진다.
 * 그래서 셋 다 "앞의 선언을 덮되 우리는 못 읽는다"(UNREADABLE)로 가야 한다.
 * 실측(Chrome 148): `CSS.supports("width","attr(w)")` 도, `env(zzz)` 도
 * true 다. 앞서는 `var(` 만 보아서 `width:1px;width:attr(w)` 를 무효로 읽고
 * **1px 를 그대로 살려 두었다** — 멀쩡한 그림을 픽셀로 오해하는 자리다.
 */
function hasVar(v: string): boolean {
  return /\b(?:var|attr|env)\(/i.test(v);
}

/**
 * 그 이름으로 불린 함수 중 **첫 인자가 빈 것**이 있나.
 *
 * `attr()`·`env()` 의 첫 인자는 무엇을 가져올지를 가리키는 이름이라 비울 수
 * 없다. 실측(Chrome): `attr(w,1px)`·`env(x,1px)` 는 true, `attr()`·`attr( )`·
 * `attr(,1px)`·`attr(,)`·`env(,1px)` 는 전부 false.
 *
 * 이름만 보고 넘어가면 그 빈 껍데기가 "덮되 못 읽음" 으로 지나가 앞의 숨김을
 * 지운다 — `width:1px;width:attr(,1px)` 가 곧 그 우회였다. **되돌림이 붙어
 * 있어도 첫 인자가 비면 무효라는 것이 요점이다**(괄호 안이 비었는지만 보면
 * 놓친다).
 */
function emptyCall(v: string, re: RegExp): boolean {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(v)) !== null) {
    let d = 1;
    let j = re.lastIndex;
    let comma = -1;
    for (; j < v.length && d > 0; j++) {
      const c = v[j];
      if (c === "(") d++;
      else if (c === ")") d--;
      else if (c === "," && d === 1 && comma < 0) comma = j;
    }
    // 짝이 맞았으면 `)` 바로 앞까지가 인자다. 안 닫혔으면 끝까지.
    const end = d === 0 ? j - 1 : v.length;
    const first = v.slice(re.lastIndex, comma < 0 ? end : comma);
    if (cssTrim(first) === "") return true;
  }
  return false;
}

/** 괄호가 짝이 맞나. 값 끝에서 열린 채로 끝나면 안 맞는 것이다. */
function balanced(v: string): boolean {
  let d = 0;
  for (const c of v) {
    if (c === "(") d++;
    else if (c === ")") d = Math.max(0, d - 1);
  }
  return d === 0;
}

/**
 * 값 끝에 열린 채로 남은 괄호를 **CSS 파서가 하는 대로** 닫아 준다.
 *
 * 실측: `CSS.supports("width","calc(1px")` 는 true 다 — 토크나이저가 입력이
 * 끝나면 열린 함수를 스스로 닫는다. 앞서는 우리만 이것을 무효로 보아
 * `width:1px;width:calc(100px` 에서 1px 이 살아남았다(**잘못 막기**).
 *
 * 따옴표 안의 괄호는 세지 않는다 — 거기 것은 글자다.
 */
function closeUnbalanced(v: string): string {
  let d = 0;
  let quote: string | null = null;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") i++;
    else if (c === '"' || c === "'") quote = c;
    else if (c === "(") d++;
    else if (c === ")") d = Math.max(0, d - 1);
  }
  return d > 0 ? v + ")".repeat(d) : v;
}

/** `var()` 를 푼 결과. 셋을 **반드시 구별해야 한다**(아래 주석). */
type VarResult =
  | { kind: "ok"; value: string }
  /** 값 자체가 깨졌다(괄호가 안 닫힘 · 이름이 `--` 로 안 시작). 선언이 무효다. */
  | { kind: "bad" }
  /** 문법은 멀쩡한데 무엇이 될지 모른다. 앞의 선언을 덮되 못 읽는다. */
  | { kind: "unresolved" };

/**
 * `var(--x)` 를 **같은 style 안에서 정의된** 사용자 정의 속성으로 바꾼다.
 * 하나라도 못 풀면 null — 그때는 값이 무엇이 될지 우리가 모른다.
 *
 * 왜 붙이는 공백이 중요한가: CSS 는 **토큰 단위**로 바꿔 끼운다. 실측 —
 * `--a:non;display:var(--a)e` 는 `none` 이 되지 **않고**(40×20 그대로 보인다)
 * `non` 과 `e` 두 토큰이 되어 무효가 된다. 글자로 이어 붙이면 우리만 `none`
 * 으로 읽어 멀쩡한 그림을 막는다.
 */
function substituteVars(
  v: string,
  vars: Map<string, string>,
  depth = 0,
): VarResult {
  if (depth > 8) return { kind: "unresolved" }; // 서로 물린 정의
  /*
   * `attr()`·`env()` 는 우리가 풀 길이 없다 — 값은 계산할 때 정해진다.
   *
   * 괄호가 안 닫힌 것은 갈라 낸다. CSS 파서는 값 끝에서 열린 괄호를 **스스로
   * 닫으므로** `attr(` 는 곧 `attr()` 인데, 인자 없는 `attr()` 는 무효다.
   * 실측(Chrome): `attr(w)`·`env(x)` 는 true, `attr(`·`env(` 는 false.
   *
   * **인자가 비어 있는 것도 같이 갈라야 한다.** 앞서는 괄호 짝만 보아서
   * `attr()`·`env()` 를 "덮되 못 읽음" 으로 놓았는데, Chrome 은 그 선언을
   * 파싱 때 버린다(실측: 둘 다 CSS.supports false). 그래서
   * `width:1px;height:1px;width:attr();height:attr()` 한 줄에 판정이 뒤집혀
   * **추적 픽셀이 그대로 지나갔다.**
   */
  if (/\b(?:attr|env)\(/i.test(v)) {
    if (!balanced(v)) return { kind: "bad" };
    if (emptyCall(v, /\b(?:attr|env)\(/gi)) return { kind: "bad" };
    return { kind: "unresolved" };
  }
  let out = "";
  let i = 0;
  while (i < v.length) {
    const m = /\bvar\(/iy;
    m.lastIndex = i;
    if (!m.exec(v)) {
      out += v[i++];
      continue;
    }
    // 짝이 맞는 `)` 까지, 그리고 첫 최상위 `,` 를 찾는다
    let d = 1;
    let j = m.lastIndex;
    let comma = -1;
    for (; j < v.length && d > 0; j++) {
      const c = v[j];
      if (c === "(") d++;
      else if (c === ")") d--;
      else if (c === "," && d === 1 && comma < 0) comma = j;
    }
    /*
     * 여기부터 두 갈래를 **가른다**. 앞서는 둘 다 null 이었고, null 은
     * UNREADABLE 로 이어졌다. 그래서 `display:none;display:var(` 한 줄로
     * 판정이 뒤집혔다 — Chrome 은 깨진 값을 **파싱 때 버려** display:none 을
     * 그대로 두는데(=여전히 안 보인다) 우리는 "덮었지만 못 읽음" 으로 읽어
     * 픽셀을 내보냈다. 실측으로 확인했다(CSS.supports 가 false).
     */
    if (d > 0) return { kind: "bad" }; // 괄호가 안 닫힌다
    const inner = v.slice(m.lastIndex, j - 1);
    const name = cssTrim(comma < 0 ? inner : v.slice(m.lastIndex, comma));
    const fallback = comma < 0 ? null : v.slice(comma + 1, j - 1);
    if (!name.startsWith("--")) return { kind: "bad" }; // `var(a)`

    /*
     * ── 되돌림(fallback)은 언제 쓰이나 ──
     * CSS 는 정의가 **없거나 guaranteed-invalid** 일 때만 되돌림을 쓴다.
     * `initial` 이 곧 guaranteed-invalid 이고, **빈 값은 어엿한 값이라
     * 되돌림을 안 쓴다.** 앞서는 `정의가 있고 && 빈 값이 아닐 때` 로 갈라
     * 양쪽으로 다 틀렸다 (전부 Chrome 실측):
     *   `--a:initial;display:var(--a,none)`   Chrome none  ← 우리는 통과시켰다
     *   `--a: ;display:var(--a,none)`         Chrome 40×20 ← 우리는 막았다
     */
    const defined = vars.get(name);
    /*
     * 사용자 정의 속성의 **값**은 대소문자를 그대로 두지만, 여기서 견주는
     * `initial` 은 CSS 전역 낱말이라 대소문자를 안 가린다. 실측: Chrome 에서
     * `--a:INITIAL;display:var(--a,none)` 은 **숨겨진다**. 소문자만 보다가
     * 이 한 글자에 판정이 뒤집혀 추적 픽셀이 지나갔다.
     */
    /*
     * `initial` 만이 아니다. `inherit`·`unset`·`revert`·`revert-layer` 도 사용자
     * 정의 속성에서는 결국 guaranteed-invalid 라 Chrome 이 폴백을 쓴다(실측:
     * `--a:unset;display:var(--a,none)` → 상자 0×0, 안 보인다). 하나만 보다가
     * 나머지 넷에서 추적 픽셀이 지나갔다.
     */
    const invalidAtParse =
      defined === undefined ||
      ["initial", "inherit", "unset", "revert", "revert-layer"].includes(
        cssTrim(defined).toLowerCase(),
      );
    let sub: VarResult;
    if (invalidAtParse) {
      sub =
        fallback === null
          ? { kind: "unresolved" }
          : substituteVars(fallback, vars, depth + 1);
    } else {
      sub = substituteVars(defined, vars, depth + 1);
      // 정의가 안 풀리면 그 사용자 정의 속성이 guaranteed-invalid 다 → 되돌림
      if (sub.kind !== "ok" && fallback !== null) {
        const fb = substituteVars(fallback, vars, depth + 1);
        if (fb.kind === "ok") sub = fb;
        else sub = { kind: "unresolved" };
      } else if (sub.kind === "bad") {
        // 깨진 것은 **정의 쪽**이지 이 선언이 아니다
        sub = { kind: "unresolved" };
      }
    }
    if (sub.kind !== "ok") return sub;
    out += ` ${cssTrim(sub.value)} `;
    i = j;
  }
  return { kind: "ok", value: out };
}

/**
 * `style` 속성을 **CSS 가 접는 대로** 접는다.
 *
 * 앞에서는 "마지막이 이긴다" 로만 접었다. CSS 는 그렇지 않다 — **무효한 선언은
 * 버리고 앞의 유효한 선언을 남긴다.** 그래서 뒤에 쓰레기 한 줄을 붙이는 것만으로
 * 판정이 통째로 뒤집혔다. 실측(Chrome): `display:none;display:zzz` 는 여전히
 * `display:none`(rect 0×0)인데 우리는 그냥 통과시켰고, 그 픽셀은 `blocked` 가
 * 아니라 `proxied` 로 세어져 **화면 경고까지 사라졌다.** 대표 스타일 14개 중
 * 13개가 이 한 수에 뒤집혔다.
 *
 * 접는 규칙 셋 — 셋 다 실측으로 확인했다:
 * 1. **무효한 선언은 무시한다**(덮어쓰지 않는다). `display:none;display:zzz` → none
 * 2. **유효하면 덮어쓴다.** `display:none;display:block` → block (막으면 안 된다)
 * 3. **`!important` 가 이긴다.** `display:none!important;display:block` → none.
 *    important 끼리는 뒤가 이기고(`none!imp;block!imp` → block), important 인데
 *    무효한 것은 그냥 버려진다(`none!imp;zzz!imp` → none).
 *
 * `var()` 는 넷째 규칙이 필요하다. **파싱 때는 유효하므로 앞의 것을 반드시
 * 덮는다.** 풀어 본 값이 무효해도 앞 선언이 되살아나지 않는다 — 실측:
 * `display:none;display:var(--없는것)` 은 40×20 으로 **보인다**(none 이 아니라
 * 초깃값으로 돌아간다). 그래서 못 푼 `var()` 는 "무시" 가 아니라 `UNREADABLE`
 * 이다.
 *
 * ── 한계 ──
 * 사용자 정의 속성은 **같은 style 안에 적힌 것만** 푼다. 바깥에서 물려받는 것
 * (`<div style="--a:none"><img style="display:var(--a)">`)은 못 푼다 — 이
 * 콜백이 보는 것은 그 `img` 한 태그뿐이다. 부모가 `display:none` 으로 숨기는
 * 것을 못 보는 것과 같은 종류의 한계다.
 */
function parseInlineStyle(style: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!style) return out;

  const decls = splitDeclarations(style);

  /*
   * 사용자 정의 속성을 **먼저** 다 모은다. 같은 블록 안에서는 적은 차례가
   * 상관없다 — 실측: `display:var(--a);--a:none` 도 그려지지 않는다.
   */
  const vars = new Map<string, string>();
  const varImportant = new Set<string>();
  for (const d of decls) {
    if (!d.prop.startsWith("--")) continue;
    if (varImportant.has(d.prop) && !d.important) continue;
    vars.set(d.prop, closeUnbalanced(d.raw));
    if (d.important) varImportant.add(d.prop);
  }

  const important = new Set<string>();
  for (const d of decls) {
    if (d.prop.startsWith("--")) continue;
    // 앞에 !important 로 박힌 값은 보통 선언이 못 이긴다
    if (important.has(d.prop) && !d.important) continue;

    // 파서가 값 끝에서 열린 괄호를 스스로 닫는다 — 우리도 먼저 닫고 본다
    const raw0 = closeUnbalanced(d.raw);
    let usesVar = hasVar(raw0);
    let v: string | null = raw0;
    /** 값이 **깨져서** 못 읽는가. 그러면 앞의 선언을 덮지 않는다. */
    let broken = false;
    const resolve = (raw: string): string | null => {
      const r = substituteVars(raw, vars);
      if (r.kind === "ok") return r.value;
      if (r.kind === "bad") broken = true;
      return null;
    };
    if (usesVar) v = resolve(v);
    if (v !== null) {
      v = cssUnescape(v);
      // 이스케이프를 푼 뒤에야 드러나는 `\76 ar(--a)` 도 한 번 더 본다
      if (!usesVar && hasVar(v)) {
        usesVar = true;
        v = resolve(v);
      }
    }
    const value = v === null ? null : cssTrim(v).toLowerCase();

    let store: string;
    if (value !== null && GLOBAL_KEYWORDS.has(value)) {
      // 무엇이 될지는 바깥(부모·UA 시트)을 봐야 안다
      store = UNREADABLE;
    } else if (value !== null && isValidValue(d.prop, value)) {
      store = value;
    } else if (usesVar && !broken) {
      // 파싱 때는 유효했으니 앞의 것을 덮되, 값은 못 읽는다
      store = UNREADABLE;
    } else {
      continue; // 무효한 선언 — **덮어쓰지 않고 버린다**
    }

    out.set(d.prop, store);
    if (d.important) important.add(d.prop);
  }
  return out;
}
/**
 * CSS 숫자. 부호·앞자리 없는 소수점·지수를 전부 받는다.
 *
 * 실측(Chrome): `.5px`→0.5px · `+0px`→0px · `1e0px`→1px · `1e1px`→10px ·
 * `0.5e1px`→5px. 앞의 정규식(`^\d+(\.\d+)?`)은 이 다섯을 전부 "못 읽음" 으로
 * 떨궈서, 그대로 통과시켰다.
 *
 * **소수점 뒤에는 숫자가 반드시 온다.** 앞서는 `\d+(?:\.\d*)?` 라 뒤가 빈
 * `1.` 도 숫자로 읽었는데, CSS 토크나이저는 `.` 다음이 숫자일 때만 소수점으로
 * 읽는다. 그래서 `1.px` 는 CSS 에서 숫자 `1` 과 식별자 `.px` **두 토큰**이라
 * 선언이 통째로 무효인데(실측: `CSS.supports("width","1.px")` false, 그림은
 * 1×1 그대로 남는다) 우리만 1px 로 읽어 **판정이 뒤집혔다** —
 * `width:1px;height:1px;width:100.px;height:100.px` 로 추적 픽셀이 지나갔다.
 * `1.e1px` 도 같은 수다(지수 앞의 `.` 역시 소수점이 아니다).
 *
 * 갈래의 **차례가 중요하다**: `\d+` 를 앞에 두면 `1.5px` 에서 `1` 만 집고
 * 남은 `.5px` 를 단위로 읽어 멀쩡한 값을 무효로 만든다. 소수 꼴을 먼저 본다.
 */
const CSS_NUMBER = /^[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?/;

/** 픽셀로 옮길 수 있는 절대 단위만. 나머지는 그릇을 알아야 뜻이 선다. */
const ABSOLUTE_UNITS: Record<string, number> = {
  px: 1,
  pt: 4 / 3,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

/**
 * CSS 가 **길이로 받는** 단위 전부. 픽셀로 못 옮기는 것까지 다 든다.
 *
 * 이 집합이 가르는 것은 "읽어 낼 수 있나" 가 아니라 "CSS 가 값으로 받나" 다.
 * 빠뜨리면 `width:1px;width:2lh` 에서 뒤엣것을 무효로 보고 1px 을 남겨,
 * **멀쩡한 그림을 막는다.** (`%` 는 길이가 아니라 백분율이라 따로 본다.)
 */
const LENGTH_UNITS = new Set([
  ...Object.keys(ABSOLUTE_UNITS),
  "em", "rem", "ex", "rex", "ch", "rch", "ic", "ric", "cap", "rcap",
  "lh", "rlh",
  "vw", "vh", "vi", "vb", "vmin", "vmax",
  "svw", "svh", "svi", "svb", "svmin", "svmax",
  "lvw", "lvh", "lvi", "lvb", "lvmin", "lvmax",
  "dvw", "dvh", "dvi", "dvb", "dvmin", "dvmax",
  "cqw", "cqh", "cqi", "cqb", "cqmin", "cqmax",
]);

function unitOf(v: string): { n: number; unit: string } | null {
  const m = CSS_NUMBER.exec(v);
  if (!m) return null;
  const raw = Number(m[0]);
  if (Number.isNaN(raw)) return null;
  /*
   * 넘치는 지수(`1e400`)는 **무효가 아니다.** CSS 는 그것을 받아 제 상한으로
   * 자른다(실측: `CSS.supports("width","1e400px")` true). 앞서는 여기서
   * `Number.isFinite` 가 false 라 null 을 내 그 선언을 무효로 봤고, 그러면
   * `width:1px;width:1e400px` 에서 **1px 이 살아남아 멀쩡한 그림을 막았다.**
   * 우리도 아주 큰 수로 잘라 둔다 — 뒤의 셈에서 Infinity 가 0 을 만나
   * NaN 이 되는 일을 막으려고 유한한 값으로 자른다.
   */
  const n = raw === Infinity ? 1e30 : raw === -Infinity ? -1e30 : raw;
  const rest = v.slice(m[0].length);
  /*
   * 숫자와 단위 사이는 벌어질 수 없다. CSS 토크나이저가 `1px` 을 **한 덩이**로
   * 읽어서, 사이가 벌어지면 두 토큰이 되고 선언이 통째로 무효가 된다.
   *
   * 실측(Chrome): `width:1 px` 도 `width:1[주석]px` 도 본디 크기(40×20)로
   * 그려진다 — 위 parseInlineStyle 이 주석을 공백으로 바꾸므로 둘은 여기에
   * 같은 꼴로 온다. 이걸 안 보면 **멀쩡한 그림을 1px 로 오해해 막는다**.
   */
  if (rest !== "" && CSS_WS.includes(rest[0])) return null;
  /*
   * 여기서 `rest.trim()` 을 쓰면 안 된다 — JS 의 trim 은 NBSP 를 벗겨서
   * `1px&nbsp;` 를 `1px` 로 읽는다. 실측(Chrome): `width:1px&nbsp;` 은 무효라
   * 그림이 40×20 으로 그대로 보이는데, 그것을 1px 로 읽으면 **멀쩡한 그림을
   * 막는다.** 실제로 이 한 줄 때문에 NBSP 를 붙인 표본 일곱 개가 잘못 막혔다.
   */
  return { n, unit: cssTrim(rest) };
}

/* ── calc() ─────────────────────────────────────────────────────────────
 *
 * 실측(Chrome): `calc(1px)`·`CALC( 1px )`·`calc(2px - 1px)` 이 전부 1×1 로,
 * `calc(0px)` 은 0×0 으로 그려진다. `1px` 이라 적으면 막히고 `calc(1px)` 이라
 * 적으면 지나간다면, 그것은 값이 아니라 **표기**로 판정을 뒤집는 자리다.
 *
 * 절대 단위와 순수한 수만 계산한다. `%`·`em` 처럼 그릇을 알아야 풀리는 것이
 * 하나라도 섞이면 통째로 "못 읽음"(null)으로 둔다 — 모르면 막지 않는 쪽이다.
 */

/** 계산 중인 값. `len` 이면 픽셀 길이, 아니면 순수한 수. */
type CalcVal = { n: number; len: boolean };

function calcTokens(s: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  /*
   * 앞에 빈칸이 있었나. `+`·`-` 를 **더하기·빼기로 쓸 때**는 CSS 가 양옆에
   * 빈칸을 요구한다 — `calc(1px+ 1px)` 을 Chrome 은 통째로 버린다.
   * 빈칸을 세지 않고 2px 로 읽었더니 `width:600px;width:calc(1px+ 1px)` 인
   * **멀쩡한 그림**(실측 600×300)을 픽셀로 오해해 막았다. 못 막는 것보다
   * 잘못 막는 것이 더 나쁜 고장이라 여기서 센다.
   * (값 앞의 부호 — `calc(-1px)` · `calc(2px * -1)` — 는 이 규칙 밖이다.)
   */
  let spaced = true;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      spaced = true;
      i++;
      continue;
    }
    if ("()*/+-".includes(c)) {
      if (c === "+" || c === "-") {
        const prev = out[out.length - 1];
        const binary = prev !== undefined && prev !== "(" && !"*/+-".includes(prev);
        if (binary && !(spaced && /\s/.test(s[i + 1] ?? ""))) return null;
      }
      out.push(c);
      spaced = false;
      i++;
      continue;
    }
    spaced = false;
    const m = CSS_NUMBER.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    const u = /^[a-z%]*/.exec(s.slice(i));
    const unit = u ? u[0] : "";
    i += unit.length;
    out.push(m[0] + unit);
  }
  return out;
}

function calcSum(t: string[], p: { i: number }): CalcVal | null {
  let left = calcProduct(t, p);
  while (left && (t[p.i] === "+" || t[p.i] === "-")) {
    const op = t[p.i++];
    const right = calcProduct(t, p);
    // 길이와 순수한 수는 못 더한다 — CSS 도 `calc(1px + 1)` 을 버린다
    if (!right || right.len !== left.len) return null;
    left = { n: op === "+" ? left.n + right.n : left.n - right.n, len: left.len };
  }
  return left;
}

function calcProduct(t: string[], p: { i: number }): CalcVal | null {
  let left = calcUnary(t, p);
  while (left && (t[p.i] === "*" || t[p.i] === "/")) {
    const op = t[p.i++];
    const right = calcUnary(t, p);
    if (!right) return null;
    if (op === "*") {
      if (left.len && right.len) return null; // px * px 는 길이가 아니다
      left = { n: left.n * right.n, len: left.len || right.len };
    } else {
      if (right.len || right.n === 0) return null; // px/px · 0 으로 나누기
      left = { n: left.n / right.n, len: left.len };
    }
  }
  return left;
}

function calcUnary(t: string[], p: { i: number }): CalcVal | null {
  let sign = 1;
  while (t[p.i] === "+" || t[p.i] === "-") {
    if (t[p.i] === "-") sign = -sign;
    p.i++;
  }
  const tok = t[p.i];
  if (tok === undefined) return null;
  if (tok === "(") {
    p.i++;
    const v = calcSum(t, p);
    if (!v || t[p.i] !== ")") return null;
    p.i++;
    return { n: v.n * sign, len: v.len };
  }
  p.i++;
  const u = unitOf(tok);
  if (!u) return null;
  if (u.unit === "") return { n: u.n * sign, len: false };
  const factor = ABSOLUTE_UNITS[u.unit];
  return factor === undefined ? null : { n: u.n * factor * sign, len: true };
}

/** `calc(…)` 를 픽셀로. 길이로 안 떨어지면 null. */
function evalCalc(v: string): number | null {
  if (!v.startsWith("calc(") || !v.endsWith(")")) return null;
  const t = calcTokens(v.slice(5, -1));
  if (!t) return null;
  const p = { i: 0 };
  const r = calcSum(t, p);
  // 토큰을 남김없이 썼고, 결과가 **길이**여야 한다 (`calc(1)` 은 폭이 아니다)
  return r && p.i === t.length && r.len ? r.n : null;
}

/** 최상위 쉼표로 인자를 가른다. 괄호 안의 쉼표는 구분자가 아니다. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** 인자 하나를 픽셀 길이로. 길이로 안 떨어지면 null. */
function argLength(s: string): number | null {
  const t = calcTokens(cssTrim(s));
  if (!t || t.length === 0) return null;
  const p = { i: 0 };
  const r = calcSum(t, p);
  return r && p.i === t.length && r.len ? r.n : null;
}

/**
 * 수학 함수 한 덩이를 픽셀로. 길이로 안 떨어지면 null.
 *
 * **`calc()` 만 계산하던 것이 이 기능의 한 줄 약속을 무르게 했다.**
 * `width:clamp(0px,1px,2px)` 는 Chrome 이 1×1 로 그리는데, 앞에 숨기는 선언도
 * 이상한 표기도 없이 **그 한 줄만으로** 크기 판정이 통째로 건너뛰어져 추적
 * 픽셀이 그대로 나갔다(실측). `min`·`max`·`round`·`abs`·`mod`·`rem`·`hypot`·
 * `-webkit-calc` 도 같았다. 값이 아니라 **표기**로 판정이 뒤집히는 자리다.
 *
 * 유효성 검사(`CSS.supports` 대조)가 이걸 못 잡은 이유를 적어 둔다 — 그 대조는
 * "CSS 가 받아들이는가" 만 재는데, 여기서 필요한 것은 "**얼마나 작은가**" 다.
 * 두 물음은 다르다. 새 수학 함수를 더할 때는 대조표가 아니라 이 함수를 봐라.
 *
 * 절대 단위만 센다. `%`·`em` 이 하나라도 섞이면 그릇을 알아야 풀리므로 null 로
 * 두고 **막지 않는다** — 모르면 막지 않는 쪽이다.
 * 인자 안에 다시 함수가 오는 것(`clamp(0px, calc(1px), 2px)`)은 못 읽는다.
 */
function evalMathLength(v: string): number | null {
  const m = /^(?:-webkit-)?([a-z][a-z0-9]*)\((.*)\)$/is.exec(v);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const body = m[2];
  if (name === "calc") return evalCalc(`calc(${body})`);

  const raw = splitArgs(body);
  // `round(nearest, 1.4px, 1px)` — 첫 인자가 어림 방식이면 떼어 낸다.
  const strategy = cssTrim(raw[0] ?? "").toLowerCase();
  const args = ["nearest", "up", "down", "to-zero"].includes(strategy)
    ? raw.slice(1)
    : raw;
  const n = args.map(argLength);
  if (n.some((x) => x === null) || n.length === 0) return null;
  const v0 = n as number[];

  switch (name) {
    case "min":
      return Math.min(...v0);
    case "max":
      return Math.max(...v0);
    case "clamp":
      // clamp(MIN, VAL, MAX) = max(MIN, min(VAL, MAX))
      return v0.length === 3 ? Math.max(v0[0], Math.min(v0[1], v0[2])) : null;
    case "abs":
      return v0.length === 1 ? Math.abs(v0[0]) : null;
    case "hypot":
      return Math.hypot(...v0);
    case "mod":
    case "rem": {
      if (v0.length !== 2 || v0[1] === 0) return null;
      const r = v0[0] % v0[1];
      // `mod` 는 나누는 수의 부호를 따르고 `rem` 은 나뉘는 수의 부호를 따른다.
      return name === "rem" || r === 0 || Math.sign(r) === Math.sign(v0[1])
        ? r
        : r + v0[1];
    }
    case "round": {
      if (v0.length !== 2 || v0[1] === 0) return null;
      const q = v0[0] / v0[1];
      const f =
        strategy === "up"
          ? Math.ceil
          : strategy === "down"
            ? Math.floor
            : strategy === "to-zero"
              ? Math.trunc
              : Math.round;
      return f(q) * v0[1];
    }
    default:
      // `sign`·`sqrt`·삼각 함수는 길이가 아니다. 나머지는 읽지 않는다.
      return null;
  }
}

/* ── 값이 CSS 에 **유효한가** ────────────────────────────────────────────
 *
 * 위 `parseInlineStyle` 이 "무효한 선언은 버린다" 를 지키려면 무엇이 무효인지
 * 알아야 한다. 여기서 보는 것은 **읽어 낼 수 있느냐가 아니라 CSS 가
 * 받아들이느냐**다 — 둘은 다르다. `width:50%` 는 우리가 픽셀로 못 옮기지만
 * CSS 에는 어엿이 유효해서, 앞의 `width:1px` 을 **덮어야 한다**. 여기서
 * 무효라고 하면 `width:1px;width:50%` 가 1px 로 남아 멀쩡한 그림을 막는다.
 *
 * 그래서 두 쪽 다 틀리면 안 된다:
 *   너무 헐거우면 → `display:none;display:zzz` 가 뚫린다 (A 의 우회)
 *   너무 빡빡하면 → 유효한 값을 버려 앞의 숨김이 살아남는다 (잘못 막기)
 * 아래 표는 지어낸 것이 아니라 **`CSS.supports()` 와 맞대어 확인**했다
 * (rig/valid.ts + rig/notation9.html, 300여 쌍에서 어긋남 0).
 */

const ANGLE_UNITS = new Set(["deg", "grad", "rad", "turn"]);

/** 수학 함수. 안이 무엇이든 **꼴만 맞으면** CSS 는 값으로 받는다. */
const MATH_FNS = new Set([
  "calc", "min", "max", "clamp", "round", "mod", "rem", "abs", "sign", "hypot",
  // 지수·삼각 무리. 빠뜨리면 `width:1px;width:calc(sqrt(4) * 1px)` 에서
  // 뒷줄을 무효로 보아 1px 이 살아남고 **멀쩡한 그림을 막는다**(실측: Chrome 은
  // 받는다). 인자의 **유형까지** 봐야 한다 — `sqrt(1px)` 는 Chrome 도 버린다.
  "pow", "sqrt", "exp", "log", "sin", "cos", "tan", "asin", "acos", "atan",
  "atan2",
]);

/**
 * 수학식 안의 이름 있는 상수. 전부 단위 없는 수다.
 * 실측: `calc(pi * 1px)`·`calc(infinity * 1px)`·`calc(nan * 1px)` 다 유효하다.
 */
const MATH_CONSTANTS = new Set(["e", "pi", "infinity", "-infinity", "nan"]);

/**
 * `-webkit-calc(…)` 의 앞가지를 뗀다.
 *
 * 오래된 메일 HTML 이 아직 이 표기를 쓴다. 앞서는 `mathCall` 만 앞가지를 알고
 * 정작 식을 읽는 쪽은 몰라서, 이름을 통째로 모르는 식별자로 보고 **선언을
 * 무효로 만들었다** — 그쪽은 잘못 막기다.
 *
 * **`-moz-` 는 안 뗀다.** 실측: `CSS.supports("width","-moz-calc(1px)")` 가
 * false 다 — Chrome 은 그 표기를 안 받는다. 받아 주면 `width:1px;
 * width:-moz-calc(100px)` 로 판정이 뒤집힌다(우회). Firefox 도 `-webkit-calc`
 * 는 받으므로, `-moz-` 를 버려서 잃는 것은 2012년 표기뿐이다.
 */
const stripVendor = (name: string): string => name.replace(/^-webkit-/, "");

/** 값의 유형. `lenpct` 는 길이와 백분율이 섞인 calc 다. */
type ValueType = "num" | "len" | "pct" | "lenpct" | "ang" | null;

function unifyAdd(a: ValueType, b: ValueType): ValueType {
  if (a === null || b === null) return null;
  if (a === b) return a;
  const pair = new Set([a, b]);
  // 길이 + 백분율은 CSS 가 받는다 (`calc(100% - 8px)`)
  if (pair.has("len") && pair.has("pct")) return "lenpct";
  if (pair.has("lenpct") && (pair.has("len") || pair.has("pct"))) return "lenpct";
  return null;
}

/** 수학식 토큰내기. 부호 붙은 숫자와 연산자 `-` 를 갈라야 한다. */
function mathTokens(s: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (CSS_WS.includes(c)) {
      i++;
      continue;
    }
    const num = CSS_NUMBER.exec(s.slice(i));
    /*
     * `-` 뒤에 **바로 글자**가 오면 그것은 뺄셈이 아니라 이름의 일부다 —
     * `-webkit-calc(` 의 앞가지와, 스펙이 낱말 하나로 정한 상수 `-infinity`.
     * CSS 의 뺄셈은 연산자 양옆에 공백을 **반드시** 두므로(`calc(1px-2px)` 는
     * 무효다) 이렇게 갈라도 뺄셈을 잘못 읽지 않는다. 앞서는 `-webkit-calc(1px)`
     * 이 `-` + `webkit-calc` 로 쪼개져 **멀쩡한 값이 무효가 됐다.**
     */
    const identAfterDash =
      (c === "-" || c === "+") && /^[a-z_]/i.test(s[i + 1] ?? "");
    // `- 2px` 의 `-` 는 연산자, `-2px` 의 `-` 는 숫자의 일부다
    if (
      "()*/,".includes(c) ||
      ((c === "+" || c === "-") && !num && !identAfterDash)
    ) {
      out.push(c);
      i++;
      continue;
    }
    if (num) {
      i += num[0].length;
      const u = /^[a-z%]*/i.exec(s.slice(i))?.[0] ?? "";
      i += u.length;
      out.push((num[0] + u).toLowerCase());
      continue;
    }
    const id = /^[+-]?[a-z_-][a-z0-9_-]*/i.exec(s.slice(i));
    if (!id) return null;
    i += id[0].length;
    out.push(id[0].toLowerCase());
  }
  return out;
}

interface MathPos {
  t: string[];
  i: number;
}

function mathSum(p: MathPos): ValueType {
  let left = mathProduct(p);
  while (left && (p.t[p.i] === "+" || p.t[p.i] === "-")) {
    p.i++;
    left = unifyAdd(left, mathProduct(p));
  }
  return left;
}

function mathProduct(p: MathPos): ValueType {
  let left = mathPrimary(p);
  while (left && (p.t[p.i] === "*" || p.t[p.i] === "/")) {
    const op = p.t[p.i++];
    const right = mathPrimary(p);
    if (right === null) return null;
    // 곱은 한쪽이 순수한 수여야 한다
    if (op === "*") {
      left = left === "num" ? right : right === "num" ? left : null;
      continue;
    }
    /*
     * 나눗셈은 **같은 유형끼리도 된다** — 그때 결과는 단위 없는 수다.
     * 실측: `opacity:calc(1px / 1px)`·`calc(1em / 1px)`·`calc(1deg / 1deg)` 가
     * 전부 유효하다. 앞서는 "나누는 쪽이 수일 때만" 이라 이것들을 무효로 보아
     * 앞 선언이 살아남았다 — **잘못 막기** 쪽이다.
     * 백분율은 아직 무엇이 될지 안 정해져 어느 쪽과도 나뉜다(실측:
     * `1% / 1deg` 유효, `1px / 1deg` 무효).
     */
    if (right === "num") continue; // left 그대로
    // 단위 없는 수를 단위로 나눌 수는 없다 (실측: `calc(1 / 1%)` 무효)
    const mixable =
      left !== "num" && (left === "pct" || right === "pct" || left === right);
    left = mixable ? "num" : null;
  }
  return left;
}

function mathPrimary(p: MathPos): ValueType {
  const tok = p.t[p.i];
  if (tok === undefined) return null;
  if (tok === "(") {
    p.i++;
    const v = mathSum(p);
    if (v === null || p.t[p.i] !== ")") return null;
    p.i++;
    return v;
  }
  /*
   * 상수는 **낱말 하나**다. 스펙이 `-infinity` 를 통째로 한 낱말로 적었고,
   * 사이를 벌린 `calc(- infinity)` 는 Chrome 도 안 받는다 — 그래서 여기서도
   * 두 토큰으로는 안 받는다.
   */
  if (MATH_CONSTANTS.has(tok)) {
    p.i++;
    return "num";
  }
  if (MATH_FNS.has(stripVendor(tok)) && p.t[p.i + 1] === "(") {
    const name = stripVendor(tok);
    p.i += 2;
    const args: ValueType[] = [];
    for (;;) {
      // `round(up, 1px, 2px)` 의 첫 인자는 반올림 방식이라 수가 아니다
      const strategy = p.t[p.i];
      if (
        name === "round" &&
        args.length === 0 &&
        ["nearest", "up", "down", "to-zero"].includes(strategy)
      ) {
        p.i++;
      } else {
        const v = mathSum(p);
        if (v === null) return null;
        args.push(v);
      }
      if (p.t[p.i] === ",") {
        p.i++;
        continue;
      }
      break;
    }
    if (p.t[p.i] !== ")") return null;
    p.i++;
    const n = args.length;
    /*
     * ── 지수·삼각 무리는 인자의 **유형**까지 봐야 한다 ──
     * 여기를 개수만 보고 넘어가면 `sqrt(1px)` 같은 것을 유효로 읽어, 이번에는
     * 반대로 **우회**가 된다(Chrome 은 단위 붙은 인자를 버린다). 실측으로
     * 갈래를 갈랐다: 인자가 단위 없는 수여야 하는 것 / 각도도 되는 것 /
     * 결과가 각도인 것.
     */
    const allNum = args.every((a) => a === "num");
    /*
     * ── 백분율을 받는 두 함수는 서로 다르게 움직인다 (전부 실측) ──
     *   sqrt: 유형을 **그대로 물려준다**(abs 와 같다)
     *     width:sqrt(1%) 유효 · calc(sqrt(1%) * 1px) 무효 · calc(sqrt(1%) + 1%) 유효
     *   exp:  백분율을 받아 **수를 낸다**(sign 과 같다)
     *     width:exp(1%) 무효 · opacity:exp(1%) 유효 · calc(exp(1%) * 1px) 유효
     * 둘을 한 규칙으로 묶으면 한쪽이 반드시 어긋난다 — sqrt 를 수로 보면
     * `width:1px;width:sqrt(1%)` 가 잘못 막히고, exp 를 물려주게 두면
     * `width:1px;width:exp(1%)` 가 **우회가 된다.**
     */
    if (name === "sqrt") {
      if (n !== 1) return null;
      return args[0] === "num" || args[0] === "pct" ? args[0] : null;
    }
    if (name === "exp") {
      if (n !== 1) return null;
      return args[0] === "num" || args[0] === "pct" ? "num" : null;
    }
    if (name === "log") return n >= 1 && n <= 2 && allNum ? "num" : null;
    if (name === "pow") return n === 2 && allNum ? "num" : null;
    if (name === "sin" || name === "cos" || name === "tan") {
      // 각도도 단위 없는 수도 받는다. 결과는 수다.
      return n === 1 && (args[0] === "num" || args[0] === "ang") ? "num" : null;
    }
    if (name === "asin" || name === "acos" || name === "atan") {
      return n === 1 && allNum ? "ang" : null;
    }
    if (name === "atan2") {
      // 두 인자의 유형이 같아야 한다. **백분율만은 안 받는다**(실측:
      // `atan2(1%,1%)` 무효, `atan2(1px,1px)`·`atan2(1deg,1deg)` 유효).
      return n === 2 && args[0] !== null && args[0] !== "pct" &&
        args[0] === args[1]
        ? "ang"
        : null;
    }
    const ok =
      name === "calc" || name === "abs" || name === "sign"
        ? n === 1
        : name === "clamp"
          ? n === 3
          : name === "mod" || name === "rem"
            ? n === 2
            : /*
               * `round(A)` 는 둘째 값을 생략한 꼴인데, 생략하면 그 자리에
               * **단위 없는 1** 이 들어간다. 그래서 A 도 단위가 없어야 한다 —
               * 실측: `round(1)` 은 유효하고 `round(1px)`·`round(1%)` 는 무효다.
               * 개수만 세면 `filter`·`width` 자리에서 그대로 우회가 된다.
               */
              name === "round"
              ? n === 2 || (n === 1 && args[0] === "num")
              : n >= 1; // min · max · hypot
    if (!ok) return null;
    let t: ValueType = args[0];
    for (let k = 1; k < n; k++) t = unifyAdd(t, args[k]);
    if (t === null) return null;
    return name === "sign" ? "num" : t;
  }
  p.i++;
  return plainTokenType(tok);
}

/** 숫자·차원·백분율 한 덩이의 유형. 함수는 여기 오지 않는다. */
function plainTokenType(tok: string): ValueType {
  const p = unitOf(tok);
  if (!p) return null;
  if (p.unit === "") return "num";
  if (p.unit === "%") return "pct";
  if (LENGTH_UNITS.has(p.unit)) return "len";
  if (ANGLE_UNITS.has(p.unit)) return "ang";
  return null;
}

/** 이 토큰이 `calc(…)` 같은 수학 함수 한 덩이인가. */
function mathCall(tok: string): string | null {
  // 이름에 숫자가 든다 — `atan2`. `-moz-` 는 Chrome 이 안 받는다(위 stripVendor)
  const m = /^(-webkit-)?([a-z][a-z0-9]*)\(/.exec(tok);
  if (!m) return null;
  const name = m[2];
  if (!MATH_FNS.has(name)) return null;
  // 여는 괄호의 짝이 **토큰의 끝**이어야 한 덩이다 (`calc(1px)zz` 는 아니다)
  let d = 0;
  for (let i = m[0].length - 1; i < tok.length; i++) {
    if (tok[i] === "(") d++;
    else if (tok[i] === ")" && --d === 0) return i === tok.length - 1 ? name : null;
  }
  return null;
}

/** 값 토큰 한 덩이의 유형. 수학 함수면 안을 풀어 본다. */
function valueTokenType(tok: string): ValueType {
  const name = mathCall(tok);
  if (!name) return plainTokenType(tok);
  const inner = mathTokens(tok);
  if (!inner) return null;
  const p = { t: inner, i: 0 };
  const v = mathPrimary(p);
  return p.i === inner.length ? v : null;
}

const isNumOrPct = (t: string): boolean => {
  const v = valueTokenType(t);
  return v === "num" || v === "pct";
};
const isAngle = (t: string): boolean => {
  const v = valueTokenType(t);
  // CSS 는 각도 자리에 단위 없는 0 을 허용한다 (`rotate(0)`)
  return v === "ang" || (v === "num" && unitOf(t)?.n === 0);
};
const isLengthPct = (t: string): boolean => {
  const v = valueTokenType(t);
  if (v === "len" || v === "pct" || v === "lenpct") return true;
  // 단위 없는 0 만은 길이다 (실측: `width:0` → 0×0). `width:5` 는 무효다.
  return v === "num" && !mathCall(t) && unitOf(t)?.n === 0;
};
/**
 * `<length>` 자리. 백분율은 **섞이기만 해도** 안 된다.
 *
 * 실측: `CSS.supports("transform","translateZ(calc(1% + 1px))")` 가 false 다.
 * 앞서는 "pct 가 아니면 길이" 로 봐서, 길이와 백분율이 섞인 calc(=lenpct)를
 * 길이로 읽었다. 그러면 `transform:translate(-9999px);
 * transform:translateZ(calc(1% + 1px))` 한 줄에 판정이 뒤집힌다.
 */
const isLength = (t: string): boolean =>
  valueTokenType(t) === "len" ||
  (valueTokenType(t) === "num" && !mathCall(t) && unitOf(t)?.n === 0);
/** 음수를 못 받는 자리(width·height·max-*). calc 안의 부호는 못 본다. */
const isNonNegLengthPct = (t: string): boolean =>
  isLengthPct(t) && (mathCall(t) !== null || (unitOf(t)?.n ?? 0) >= 0);

/** `name(a, b, …)` 를 이름과 인자로. 함수 꼴이 아니면 null. */
function callOf(tok: string): { name: string; args: string[] } | null {
  // 이름에 숫자가 든다 — `scale3d` · `translate3d` · `rotate3d` · `matrix3d`
  const m = /^([a-z0-9-]+)\(/.exec(tok);
  if (!m || !tok.endsWith(")")) return null;
  let d = 0;
  for (let i = m[0].length - 1; i < tok.length; i++) {
    if (tok[i] === "(") d++;
    else if (tok[i] === ")" && --d === 0 && i !== tok.length - 1) return null;
  }
  const inner = tok.slice(m[0].length, -1);
  // 인자는 최상위 `,` 로 나뉜다. 빈 괄호는 인자 0개다.
  const args: string[] = [];
  let buf = "";
  let depth = 0;
  for (const c of inner) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === "," && depth === 0) {
      args.push(cssTrim(buf));
      buf = "";
      continue;
    }
    buf += c;
  }
  if (cssTrim(buf) !== "" || args.length) args.push(cssTrim(buf));
  return { name: m[1], args };
}

type ArgCheck = (t: string) => boolean;

/** `<number>` 자리. 백분율은 못 온다 — `matrix()` 의 인자가 그렇다. */
const isNumber = (t: string): boolean => valueTokenType(t) === "num";

/** 음수를 못 받는 길이(`perspective`·`blur`·그림자 흐림). calc 안은 못 본다. */
const isNonNegLength = (t: string): boolean =>
  isLength(t) && (mathCall(t) !== null || (unitOf(t)?.n ?? 0) >= 0);

/** 음수를 못 받는 `<number>|<percentage>` — 필터 세기가 그렇다. */
const isNonNegNumOrPct = (t: string): boolean =>
  isNumOrPct(t) && (mathCall(t) !== null || (unitOf(t)?.n ?? 0) >= 0);

/**
 * `url(...)` 한 덩이인가.
 *
 * 앞서는 **이름만 보고 안을 안 봤다.** 그래서 `filter:opacity(0);
 * filter:url(1px 1px)` 로 판정이 뒤집혔다 — Chrome 은 그 선언을 버려
 * `opacity(0)` 을 그대로 두는데(=여전히 안 보인다) 우리만 유효로 읽었다.
 *
 * CSS 의 url 은 두 꼴이다(전부 Chrome 실측):
 *   따옴표 꼴 `url("a b")`·`url('a b')`·`url("")`  → 안에 무엇이든 온다
 *   맨 꼴    `url(#a)`·`url()`·`url( #a )`         → 공백·따옴표·괄호가 못 온다
 * 그래서 `url(a b)`·`url(a"b)`·`url(calc(1px))` 은 전부 false 다.
 */
const isUrlToken = (t: string): boolean => {
  const call = callOf(t);
  if (!call || call.name !== "url") return false;
  // 인자를 최상위 `,` 로 나누지 않는다 — url 안의 `,` 는 주소의 일부다
  const inner = cssTrim(t.slice(4, -1));
  if (inner === "") return true; // 빈 `url()` 도 Chrome 은 받는다
  if (/^"(?:[^"\\]|\\[\s\S])*"$/.test(inner)) return true;
  if (/^'(?:[^'\\]|\\[\s\S])*'$/.test(inner)) return true;
  // 맨 꼴 — 공백·따옴표·괄호는 이스케이프된 것만 온다
  return !new RegExp(`(?:^|[^\\\\])["'()${CSS_WS}]`).test(inner);
};

/**
 * 이름 있는 색 148 가지 + `transparent`·`currentcolor`.
 *
 * 왜 통째로 적는가 — `drop-shadow` 의 인자에서 **색과 길이를 갈라야** 길이가
 * 둘인지 셋인지 셀 수 있다. 이름을 모르면 `drop-shadow(zzz 1px 1px)` 같은
 * 쓰레기를 색으로 넘겨짚게 되고, 그것이 곧 "뒤에 한 줄 붙여 판정 뒤집기" 다.
 */
const COLOR_KEYWORDS = new Set(
  ("transparent currentcolor aliceblue antiquewhite aqua aquamarine azure beige bisque black " +
    "blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral " +
    "cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen " +
    "darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon " +
    "darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink " +
    "deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro " +
    "ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo " +
    "ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
    "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
    "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
    "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
    "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen " +
    /*
     * 시스템 색. 이것들을 빠뜨렸다가 **막던 것을 놓쳤다** —
     * `filter:opacity(0) drop-shadow(canvastext 1px 1px)` 에서 `drop-shadow` 를
     * 무효로 보면 `filter` **목록 전체**가 무효가 되고, 같은 목록 안의 숨기는
     * `opacity(0)` 까지 함께 버려진다. Chrome 은 이 값을 받는다(실측).
     * 색 하나가 목록을 통째로 무르게 하는 자리라 넉넉히 적어 둔다.
     */
    "canvas canvastext linktext visitedtext activetext buttonface buttontext buttonborder " +
    "field fieldtext highlight highlighttext selecteditem selecteditemtext mark marktext " +
    "graytext accentcolor accentcolortext"
  ).split(" "),
);

/** 인자가 숫자·백분율뿐인 색 함수. */
const COLOR_FNS = new Set(["rgb", "rgba", "hsl", "hsla", "hwb"]);

/**
 * 요즘 색 함수. 인자를 끝까지 읽지는 않지만 **개수는 반드시 센다.**
 *
 * 왜 여기까지만 보나 — 색을 가리는 목적은 `drop-shadow` 의 인자에서 색과
 * 길이를 갈라 **길이가 둘인지 셋인지 세는 것** 하나다. 이 이름들의 인자는
 * 길이가 될 수 없어서, 개수만 맞으면 "색 한 덩이" 로 세도 길이 세기가
 * 안 틀어진다.
 *
 * **개수를 안 세면 우회가 된다.** 이름만 보고 넘어갔더니
 * `filter:opacity(0);filter:drop-shadow(color-mix(in srgb, red) 1px 1px)` 가
 * 지나갔다 — Chrome 은 색이 하나뿐인 그 값을 버려 `opacity(0)` 을 그대로 둔다.
 * 반대로 이 이름들을 아예 모르면 `oklch(0.5 0 0)` 같은 멀쩡한 색을 무효로 보아
 * **보이는 그림을 막는다.** 양쪽 다 실측으로 갈랐다.
 *
 * `device-cmyk` 는 **뺐다** — 실측에서 Chrome 이 안 받는다.
 */
const MODERN_COLOR_FNS = new Set([
  "color", "color-mix", "lab", "lch", "oklab", "oklch",
  "light-dark", "contrast-color",
]);

/** `color()` 가 받는 색 공간. `--내가만든것`·모르는 이름은 Chrome 이 버린다. */
const COLOR_SPACES = new Set([
  "srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020",
  "xyz", "xyz-d50", "xyz-d65",
]);
/** 섞을 때 쓰는 색 공간. **각도로 도는 것(polar)만** 색상환 방식을 받는다. */
const POLAR_SPACES = new Set(["hsl", "hwb", "lch", "oklch"]);
const HUE_METHODS = new Set(["shorter", "longer", "increasing", "decreasing"]);

/** `in <색공간> [<색상환 방식> hue]?` — 섞는 방법이 문법에 맞나. */
function interpolationOk(toks: string[]): boolean {
  if (toks[0] !== "in") return false;
  const space = toks[1];
  if (!space) return false;
  const known = COLOR_SPACES.has(space) || POLAR_SPACES.has(space) ||
    space === "lab" || space === "oklab";
  if (!known) return false;
  if (toks.length === 2) return true;
  // 색상환 방식은 각도로 도는 공간에서만, 그리고 `hue` 가 반드시 뒤따른다
  return (
    toks.length === 4 &&
    POLAR_SPACES.has(space) &&
    HUE_METHODS.has(toks[2]) &&
    toks[3] === "hue"
  );
}

function modernColorOk(name: string, args: string[]): boolean {
  const toks = (i: number): string[] => cssTokens(args[i] ?? "");
  switch (name) {
    case "color-mix": {
      /*
       * `color-mix( <섞는 방법>? , <색> <백분율>? , <색> <백분율>? )`
       *
       * 섞는 방법을 **읽어야** 한다. 이름만 보고 건너뛰었더니
       * `color-mix(in oklab longer hue, red, blue)` 가 지나갔다 — `oklab` 은
       * 각도로 도는 공간이 아니라 Chrome 이 버리는 값이고, 그 자리가 곧
       * `drop-shadow` 앞의 숨김을 지우는 우회였다(실측으로 표를 떴다).
       */
      let rest = args;
      if (args.length && cssTokens(args[0])[0] === "in") {
        if (!interpolationOk(cssTokens(args[0]))) return false;
        rest = args.slice(1);
      }
      if (rest.length !== 2) return false;
      return rest.every((a) => {
        const t = cssTokens(a);
        return (
          t.length >= 1 &&
          t.filter(isColor).length === 1 &&
          t.every((x) => isColor(x) || isNumOrPct(x))
        );
      });
    }
    case "light-dark":
      return args.length === 2 && args.every((a) => cssTokens(a).every(isColor));
    case "contrast-color":
      return args.length === 1 && toks(0).length > 0;
    case "color": {
      // 첫 낱말이 **아는 색 공간 이름**이어야 하고 성분이 뒤따라야 한다.
      // 실측: `color(1 0 0)`·`color(zzz 1 0 0)`·`color(srgb)` 는 전부 무효다.
      const t = toks(0);
      return args.length >= 1 && t.length >= 2 && COLOR_SPACES.has(t[0]);
    }
    case "lab":
    case "lch":
    case "oklab":
    case "oklch":
      // 성분 셋(+ `/ 투명도`)이 한 인자에 온다
      return args.length === 1 && toks(0).length >= 3;
    default:
      return false;
  }
}

function isColor(t: string): boolean {
  if (COLOR_KEYWORDS.has(t)) return true;
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(t)) return true;
  const call = callOf(t);
  if (!call) return false;
  if (MODERN_COLOR_FNS.has(call.name)) {
    return modernColorOk(call.name, call.args);
  }
  if (!COLOR_FNS.has(call.name) || !call.args.length) return false;
  // 상대 색 표기 `rgb(from red r g b)` — 인자를 안 읽고 한 덩이로만 센다
  if (/^from\b/.test(cssTrim(call.args[0]))) return true;
  return call.args.every((a) => {
    const inner = cssTokens(a);
    return (
      inner.length > 0 &&
      // 색조 자리는 각도로도 적는다 — `hsl(1deg 2% 3%)` (실측: 유효)
      inner.every(
        (x) => x === "none" || x === "/" || isNumOrPct(x) || isAngle(x),
      )
    );
  });
}

/**
 * `drop-shadow( <color>? && <length>{2,3} )`.
 *
 * 앞서는 이 자리가 `() => true` 였다. 그래서 `filter:opacity(0);
 * filter:drop-shadow(zzz)` 한 줄에 판정이 뒤집혔다 — Chrome 은 그 선언을 버려
 * `opacity(0)` 을 그대로 두는데(=여전히 안 보인다) 우리만 유효하다고 읽었다.
 *
 * 길이는 **붙어 있어야 한다**: `1px red 1px` 는 무효다. 셋째(흐림 반경)는
 * 음수를 못 받는다. 백분율도 못 온다 — 그림자는 `<length>` 다.
 */
function dropShadowOk(arg: string): boolean {
  const toks = cssTokens(arg);
  if (!toks.length) return false;
  const lens: string[] = [];
  let colors = 0;
  let started = false;
  let broken = false;
  for (const t of toks) {
    if (isLength(t)) {
      if (broken) return false; // 길이 덩이가 색으로 끊겼다
      started = true;
      lens.push(t);
    } else if (isColor(t)) {
      if (++colors > 1) return false;
      if (started) broken = true;
    } else {
      return false;
    }
  }
  if (lens.length < 2 || lens.length > 3) return false;
  return lens.length < 3 || isNonNegLength(lens[2]);
}

/** [최소 인자, 최대 인자, 인자별 검사(모자라면 마지막 것을 되쓴다)] */
const TRANSFORM_FNS: Record<string, [number, number, ArgCheck[]]> = {
  matrix: [6, 6, [isNumber]],
  matrix3d: [16, 16, [isNumber]],
  translate: [1, 2, [isLengthPct]],
  translatex: [1, 1, [isLengthPct]],
  translatey: [1, 1, [isLengthPct]],
  translatez: [1, 1, [isLength]],
  translate3d: [3, 3, [isLengthPct, isLengthPct, isLength]],
  scale: [1, 2, [isNumOrPct]],
  scalex: [1, 1, [isNumOrPct]],
  scaley: [1, 1, [isNumOrPct]],
  scalez: [1, 1, [isNumOrPct]],
  scale3d: [3, 3, [isNumOrPct]],
  rotate: [1, 1, [isAngle]],
  rotatex: [1, 1, [isAngle]],
  rotatey: [1, 1, [isAngle]],
  rotatez: [1, 1, [isAngle]],
  rotate3d: [4, 4, [isNumber, isNumber, isNumber, isAngle]],
  skew: [1, 2, [isAngle]],
  skewx: [1, 1, [isAngle]],
  skewy: [1, 1, [isAngle]],
  perspective: [1, 1, [(t) => isNonNegLength(t) || t === "none"]],
};

const FILTER_FNS: Record<string, [number, number, ArgCheck[]]> = {
  blur: [0, 1, [isNonNegLength]],
  brightness: [0, 1, [isNonNegNumOrPct]],
  contrast: [0, 1, [isNonNegNumOrPct]],
  grayscale: [0, 1, [isNonNegNumOrPct]],
  invert: [0, 1, [isNonNegNumOrPct]],
  opacity: [0, 1, [isNonNegNumOrPct]],
  saturate: [0, 1, [isNonNegNumOrPct]],
  sepia: [0, 1, [isNonNegNumOrPct]],
  "hue-rotate": [0, 1, [isAngle]],
  "drop-shadow": [1, 1, [dropShadowOk]],
};

/**
 * 함수 목록 하나(`transform`·`filter`)가 통째로 유효한가.
 *
 * `allowUrl` 이 있는 이유: `url(#a)` 는 **filter 에만** 온다(SVG 필터 참조).
 * 앞서는 이 건너뛰기가 두 표에 함께 걸려 있어 `transform:scale(0);
 * transform:url(#a)` 로 판정이 뒤집혔다 — Chrome 은 transform 자리의 url() 을
 * 안 받는다.
 */
function fnListOk(
  value: string,
  table: Record<string, [number, number, ArgCheck[]]>,
  allowUrl: boolean,
): boolean {
  const toks = cssTokens(value);
  if (!toks.length) return false;
  for (const tok of toks) {
    if (/^url\(/.test(tok)) {
      if (allowUrl && isUrlToken(tok)) continue;
      return false;
    }
    const call = callOf(tok);
    if (!call) return false;
    const spec = table[call.name];
    if (!spec) return false;
    const [min, max, checks] = spec;
    if (call.args.length < min || call.args.length > max) return false;
    for (let i = 0; i < call.args.length; i++) {
      const check = checks[Math.min(i, checks.length - 1)];
      if (!check(call.args[i])) return false;
    }
  }
  return true;
}

/*
 * ─────────────────────────── display ───────────────────────────
 *
 * 앞서는 "사전에 든 낱말 3개 이하" 였다. 그래서 낱말 **둘을 잇기만 해도**
 * 판정이 뒤집혔다 — `display:none;display:none none` 은 Chrome 이 뒷줄을 버려
 * 여전히 `none` 인데(실측: 바탕과 변형이 같게 그려진다) 우리는 유효로 읽었다.
 * `block none`·`block block`·`none contents`·`table-cell block` 도 같은 수다.
 *
 * 문법대로 다시 적는다:
 *   [ <display-outside> || <display-inside> ] | <display-listitem>
 *   | <display-internal> | <display-box> | <display-legacy>
 * `||` 는 "각각 많아야 한 번, 차례는 상관없음" 이다. 그래서 같은 갈래를 두 번
 * 적은 `block block` 도, 갈래가 안 맞는 `block none` 도 무효다.
 */
/*
 * 낱말 갈래는 **Chrome 이 실제로 받는 것**에 맞춘다. 스펙에 있어도 Chrome 이
 * 안 받으면 우리도 안 받아야 한다 — 받으면 Chrome 이 버린 선언을 우리만
 * 유효로 읽어 앞의 숨김이 지워진다. 실측(Chrome 148, CSS.supports):
 *   `run-in` 계열 16가지 · `ruby-base` → 전부 false 라 뺐다
 *   `math` 는 <display-inside> 다 — `block math`·`math inline` 이 true
 */
const DISPLAY_OUTSIDE = new Set(["block", "inline"]);
const DISPLAY_INSIDE = new Set([
  "flow", "flow-root", "table", "flex", "grid", "ruby", "math",
]);
/** 혼자만 오는 것들 — internal · box · legacy. */
const DISPLAY_SINGLE = new Set([
  "table-row-group", "table-header-group", "table-footer-group", "table-row",
  "table-cell", "table-column-group", "table-column", "table-caption",
  // `ruby-base`·`ruby-base-container`·`ruby-text-container` 는 뺐다 —
  // 실측에서 Chrome 이 셋 다 안 받는다(`ruby-text` 만 받는다).
  "ruby-text",
  "contents", "none",
  "inline-block", "inline-table", "inline-flex", "inline-grid",
  "-webkit-box", "-webkit-inline-box", "-webkit-flex", "-webkit-inline-flex",
]);

function displayOk(toks: string[]): boolean {
  if (!toks.length) return false;
  if (toks.length === 1 && DISPLAY_SINGLE.has(toks[0])) return true;

  let outside = 0;
  let inside = 0;
  let listItem = 0;
  let insideVal = "";
  for (const t of toks) {
    if (t === "list-item") {
      listItem++;
    } else if (DISPLAY_OUTSIDE.has(t)) {
      outside++;
    } else if (DISPLAY_INSIDE.has(t)) {
      inside++;
      insideVal = t;
    } else {
      return false; // 혼자만 오는 낱말이 짝을 이뤄 왔다 (`none none` 등)
    }
  }
  if (outside > 1 || inside > 1 || listItem > 1) return false;
  if (listItem) {
    // <display-listitem> 의 안쪽은 flow 나 flow-root 만 된다
    return inside === 0 || insideVal === "flow" || insideVal === "flow-root";
  }
  return outside + inside > 0;
}

/*
 * ─────────────────────────── clip-path ───────────────────────────
 *
 * `<clip-source> | [ <basic-shape> || <geometry-box> ] | none`
 *
 * 앞서는 shape 의 **이름과 괄호만** 보고 인자를 안 봤다. 그래서
 * `clip-path:inset(100%);clip-path:circle(zzz)` 로 뒤집혔다. 그리고
 * geometry-box 를 세지 않아 `border-box border-box` 처럼 같은 갈래를 두 번
 * 적은 것도 유효로 읽었다 — `||` 는 각각 한 번씩이다.
 */
const SHAPE_BOXES = new Set([
  "border-box", "padding-box", "content-box", "margin-box",
  "fill-box", "stroke-box", "view-box",
]);
const RADIAL_EXTENT = new Set(["closest-side", "farthest-side"]);
const FILL_RULES = new Set(["nonzero", "evenodd"]);
const POS_H = new Set(["left", "right", "center"]);
const POS_V = new Set(["top", "bottom", "center"]);
const POS_EDGE_H = new Set(["left", "right"]);
const POS_EDGE_V = new Set(["top", "bottom"]);

/** `<position>` — 1·2·4 값 꼴만 받는다. */
function positionOk(toks: string[]): boolean {
  if (toks.length === 1) {
    return POS_H.has(toks[0]) || POS_V.has(toks[0]) || isLengthPct(toks[0]);
  }
  if (toks.length === 2) {
    const [a, b] = toks;
    const aKey = POS_H.has(a) || POS_V.has(a);
    const bKey = POS_H.has(b) || POS_V.has(b);
    // 키워드 둘은 차례를 가리지 않는다 — `top left` 도 맞다
    if (aKey && bKey) {
      return (POS_H.has(a) && POS_V.has(b)) || (POS_V.has(a) && POS_H.has(b));
    }
    return (POS_H.has(a) || isLengthPct(a)) && (POS_V.has(b) || isLengthPct(b));
  }
  if (toks.length === 4) {
    const pair = (k: string, v: string, set: Set<string>): boolean =>
      set.has(k) && isLengthPct(v);
    return (
      (pair(toks[0], toks[1], POS_EDGE_H) &&
        pair(toks[2], toks[3], POS_EDGE_V)) ||
      (pair(toks[0], toks[1], POS_EDGE_V) && pair(toks[2], toks[3], POS_EDGE_H))
    );
  }
  return false;
}

/** `<'border-radius'>` — `round` 뒤에 오는 것. `/` 로 가로·세로가 갈린다. */
function borderRadiusOk(toks: string[]): boolean {
  if (!toks.length) return false;
  const parts = toks.join(" ").split("/");
  if (parts.length > 2) return false;
  return parts.every((p) => {
    const t = cssTokens(p);
    return t.length >= 1 && t.length <= 4 && t.every(isNonNegLengthPct);
  });
}

/** `<lenpct>{n} [round <border-radius>]?` 꼴 shape 의 공통 몸통. */
function boxShapeOk(
  args: string[],
  counts: number[],
  each: (t: string, i: number) => boolean,
): boolean {
  if (args.length !== 1) return false; // 쉼표가 오면 안 되는 자리
  const toks = cssTokens(args[0]);
  const r = toks.indexOf("round");
  const head = r < 0 ? toks : toks.slice(0, r);
  if (!counts.includes(head.length)) return false;
  if (!head.every(each)) return false;
  return r < 0 || borderRadiusOk(toks.slice(r + 1));
}

/** `circle()`·`ellipse()` — 반지름 개수만 다르다. */
function circleOk(args: string[], sizes: number[]): boolean {
  if (args.length > 1) return false;
  const toks = args.length ? cssTokens(args[0]) : [];
  const at = toks.indexOf("at");
  const size = at < 0 ? toks : toks.slice(0, at);
  if (!sizes.includes(size.length)) return false;
  if (!size.every((t) => RADIAL_EXTENT.has(t) || isNonNegLengthPct(t))) {
    return false;
  }
  return at < 0 ? true : positionOk(toks.slice(at + 1));
}

function polygonOk(args: string[]): boolean {
  if (!args.length) return false;
  const first = cssTokens(args[0]);
  const rest =
    first.length === 1 && FILL_RULES.has(first[0]) ? args.slice(1) : args;
  if (!rest.length) return false;
  return rest.every((a) => {
    const t = cssTokens(a);
    return t.length === 2 && t.every(isLengthPct);
  });
}

function pathOk(args: string[]): boolean {
  let rest = args;
  if (args.length === 2) {
    const f = cssTokens(args[0]);
    if (!(f.length === 1 && FILL_RULES.has(f[0]))) return false;
    rest = args.slice(1);
  }
  if (rest.length !== 1) return false;
  const t = cssTokens(rest[0]);
  if (t.length !== 1) return false;
  const m = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')$/.exec(t[0]);
  // 빈 경로는 CSS 가 버린다(`CSS.supports("clip-path", 'path("")')` = false).
  // 유효로 읽으면 앞의 `clip-path:inset(100%)` 을 덮어 숨김이 풀린다.
  return m !== null && cssTrim(m[1] ?? m[2] ?? "") !== "";
}

/**
 * `shape( <fill-rule>? from <coordinate-pair>, <shape-command># )`.
 *
 * 인자를 끝까지 읽지는 않는다 — 명령 이름과 `to`/`by`, 그리고 좌표가
 * 길이인지까지만 본다. 그래도 `shape(zzz)` 같은 쓰레기는 걸러진다.
 * (남은 한계는 보고에 적었다.)
 */
const SHAPE_CMDS = new Set([
  "move", "line", "hline", "vline", "curve", "smooth", "arc", "close",
]);
const SHAPE_WORDS = new Set([
  "with", "of", "large", "small", "cw", "ccw", "rotate", "x", "y",
]);
function shapeOk(args: string[]): boolean {
  if (args.length < 2) return false;
  let first = cssTokens(args[0]);
  if (first.length && FILL_RULES.has(first[0])) first = first.slice(1);
  if (first[0] !== "from" || !positionOk(first.slice(1))) return false;
  return args.slice(1).every((a) => {
    const t = cssTokens(a);
    if (!t.length || !SHAPE_CMDS.has(t[0])) return false;
    if (t[0] === "close") return t.length === 1;
    if (t[1] !== "to" && t[1] !== "by") return false;
    return (
      t.length > 2 &&
      t
        .slice(2)
        .every(
          (x) =>
            isLengthPct(x) ||
            SHAPE_WORDS.has(x) ||
            POS_H.has(x) ||
            POS_V.has(x) ||
            isAngle(x),
        )
    );
  });
}

function basicShapeOk(tok: string): boolean {
  const call = callOf(tok);
  if (!call) return false;
  const lenPctOrAuto = (t: string): boolean => t === "auto" || isLengthPct(t);
  switch (call.name) {
    case "inset":
      return boxShapeOk(call.args, [1, 2, 3, 4], isLengthPct);
    case "rect":
      return boxShapeOk(call.args, [4], lenPctOrAuto);
    case "xywh":
      // 너비·높이는 음수를 못 받는다
      return boxShapeOk(call.args, [4], (t, i) =>
        i < 2 ? isLengthPct(t) : isNonNegLengthPct(t),
      );
    case "circle":
      return circleOk(call.args, [0, 1]);
    case "ellipse":
      return circleOk(call.args, [0, 2]);
    case "polygon":
      return polygonOk(call.args);
    case "path":
      return pathOk(call.args);
    case "shape":
      return shapeOk(call.args);
    default:
      return false;
  }
}

/*
 * ─────────────── 값을 못 읽는 길이 함수 (anchor positioning) ───────────────
 *
 * 문법은 어엿이 유효한데 값이 무엇이 될지는 **배치가 정해져야** 안다. 무효로
 * 보면 앞 선언(`width:1px`)이 살아남아 멀쩡한 그림을 픽셀로 오해한다. 유효로
 * 보면 값은 `cssLength` 가 못 읽어 UNREADABLE 과 같은 자리에 놓인다 — 그것이
 * 맞는 자리다.
 *
 * **어느 속성에서 받는지는 자리마다 다르다**(전부 Chrome 148 실측):
 *   width·height          ← anchor-size() · calc-size()
 *   max-width·max-height  ← anchor-size()
 *   left·top·right·bottom ← anchor-size() · anchor()
 *   margin 무리           ← anchor-size()
 * 그래서 토큰 검사가 아니라 **속성마다** 붙인다. `transform:
 * translateX(anchor-size(width))` 는 Chrome 이 안 받는다(실측) — 토큰 쪽에
 * 붙였으면 그것까지 유효로 읽었을 것이다.
 */
const ANCHOR_SIZE_KEYWORDS = new Set([
  "width", "height", "block", "inline", "self-block", "self-inline",
]);
const ANCHOR_SIDE_KEYWORDS = new Set([
  "inside", "outside", "top", "left", "right", "bottom", "start", "end",
  "self-start", "self-end", "center",
]);
/**
 * `calc-size()` 의 바탕값은 **그 속성이 본디 받는 값**이어야 한다. 실측:
 *   `width:calc-size(auto,size)`     true
 *   `max-width:calc-size(auto,size)` false  ← max-width 는 auto 를 안 받는다
 *   `max-width:calc-size(1px,size)`  true
 *   `width:calc-size(any,size)`      false  ← `any` 는 Chrome 이 안 받는다
 */
const CALC_SIZE_BASIS: Record<string, Set<string>> = {
  // width·height 자리 (실측: auto true · content false)
  size: new Set(["auto", "min-content", "max-content", "fit-content", "stretch"]),
  // max-* 자리 (실측: min-content true · auto false · none false)
  max: new Set(["min-content", "max-content", "fit-content", "stretch"]),
};

/** `--이름` 꼴 사용자 정의 이름. */
const isDashedIdent = (t: string): boolean => /^--[^\s]*$/.test(t);

/** anchor 무리 한 덩이가 문법에 맞나. 안 맞으면 그냥 무효다. */
function anchorFnOk(tok: string, kind: AnchorKind): boolean {
  const call = callOf(tok);
  if (!call) return false;
  if (kind === "calc-size" || kind === "calc-size-max") {
    if (call.args.length !== 2) return false;
    const b = cssTokens(call.args[0]);
    const basis = CALC_SIZE_BASIS[kind === "calc-size" ? "size" : "max"];
    return (
      b.length === 1 &&
      (basis.has(b[0]) || isLengthPct(b[0])) &&
      cssTokens(call.args[1]).length > 0
    );
  }
  if (call.args.length > 2) return false;
  const set = kind === "size" ? ANCHOR_SIZE_KEYWORDS : ANCHOR_SIDE_KEYWORDS;
  const head = call.args.length ? cssTokens(call.args[0]) : [];
  if (head.length > 2) return false;
  // `anchor()` 는 어느 변인지를 **반드시** 적어야 한다 (실측: `anchor()` false).
  // `anchor-size()` 는 빈 채로도 된다 (실측: true) — 그 자리의 축을 쓴다.
  if (kind === "side" && !head.length) return false;
  // 되돌림을 적었으면 앞자리를 비울 수 없다 (실측: `anchor-size(, 1px)` false)
  if (call.args.length === 2 && !head.length) return false;
  let named = 0;
  let sided = 0;
  for (const t of head) {
    if (isDashedIdent(t)) named++;
    else if (set.has(t) || (kind === "side" && isLengthPct(t))) sided++;
    else return false;
  }
  if (named > 1 || sided > 1) return false;
  // 되돌림 값(둘째 인자)이 **있으면** 길이여야 한다. 빈 인자는 무효다.
  if (call.args.length < 2) return true;
  const fb = cssTokens(call.args[1]);
  return fb.length > 0 && fb.every(isLengthPct);
}

/** 값 안에 그 함수가 들었나 — `calc(anchor-size(width))` 처럼 겹쳐 오기도 한다. */
type AnchorKind = "size" | "side" | "calc-size" | "calc-size-max";

function unreadableLenFn(v: string, kinds: AnchorKind[]): boolean {
  const names: Array<[string, AnchorKind]> = [
    ["anchor-size", "size"],
    ["anchor", "side"],
    ["calc-size", "calc-size"],
    ["calc-size", "calc-size-max"],
  ];
  for (const [name, kind] of names) {
    if (!kinds.includes(kind)) continue;
    const re = new RegExp("\\b" + name + "\\(", "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(v)) !== null) {
      // 열린 자리에서 짝이 맞는 `)` 를 찾아 그 덩이만 떼어 본다
      let d = 0;
      let j = m.index + name.length;
      for (; j < v.length; j++) {
        if (v[j] === "(") d++;
        else if (v[j] === ")" && --d === 0) break;
      }
      // 값 끝에서 파서가 스스로 닫는다 — `anchor-size(` 는 `anchor-size()` 다
      const piece = v.slice(m.index, j >= v.length ? v.length : j + 1) +
        (j >= v.length ? ")" : "");
      if (anchorFnOk(piece, kind)) return true;
    }
  }
  return false;
}

const keywords =
  (...ks: string[]): ((v: string, toks: string[]) => boolean) =>
  (_v, toks) =>
    toks.length === 1 && ks.includes(toks[0]);

/** 1~4 개 값 축약(margin 꼴). */
const shorthand =
  (each: ArgCheck, max = 4): ((v: string, toks: string[]) => boolean) =>
  (_v, toks) =>
    toks.length >= 1 && toks.length <= max && toks.every(each);

const SIZE_KEYWORDS = ["auto", "min-content", "max-content", "fit-content", "stretch", "-webkit-fill-available"];
const MAX_SIZE_KEYWORDS = ["none", "min-content", "max-content", "fit-content", "stretch", "-webkit-fill-available"];

const sizeCheck =
  (
    ks: string[],
    unreadable: AnchorKind[],
  ): ((v: string, toks: string[]) => boolean) =>
  (_v, toks) => {
    if (toks.length !== 1) return false;
    const t = toks[0];
    if (ks.includes(t)) return true;
    if (unreadableLenFn(t, unreadable)) return true;
    // `fit-content(20em)` 은 **넣지 않는다** — 실측에서 Chrome 이 width 자리의
    // 그것을 안 받는다(`CSS.supports("width","fit-content(20em)")` 가 false).
    // 우리가 받으면 Chrome 이 버린 선언을 우리만 유효하다고 보게 된다.
    return isNonNegLengthPct(t);
  };

/**
 * **우리가 읽는 속성**과 그 유효성 검사. 이 표의 열쇠가 곧 `isTrackingPixel`
 * 이 볼 수 있는 속성의 전부다 — 표에 없는 이름은 타입이 막는다. 검사를 빠뜨린
 * 속성이 생기면 그 속성만 "마지막이 이긴다" 로 돌아가 A 의 우회가 되살아난다.
 *
 * ── 기본은 "무효" 다 ──
 * 모든 검사가 **문법에 정확히 맞을 때만** true 를 낸다. 사전에 든 낱말인지,
 * 이름이 맞는 함수인지만 보고 넘어가는 자리는 하나도 남기지 않았다. 앞 판이
 * 뚫린 다섯 자리가 전부 그 "이름만 보고 넘어가기" 였다: 낱말 조합(display),
 * shape 인자(clip-path), url 건너뛰기(transform), `() => true`(drop-shadow),
 * 셋째 값의 갈래(translate).
 */
const VALIDATORS = {
  display: (_v: string, toks: string[]) => displayOk(toks),
  visibility: keywords("visible", "hidden", "collapse"),
  "content-visibility": keywords("visible", "auto", "hidden"),
  // `-webkit-sticky` 는 **넣지 않는다** — 실측에서 Chrome 이 안 받는다
  position: keywords("static", "relative", "absolute", "fixed", "sticky"),
  opacity: (_v: string, toks: string[]) => toks.length === 1 && isNumOrPct(toks[0]),
  width: sizeCheck(SIZE_KEYWORDS, ["size", "calc-size"]),
  height: sizeCheck(SIZE_KEYWORDS, ["size", "calc-size"]),
  "max-width": sizeCheck(MAX_SIZE_KEYWORDS, ["size", "calc-size-max"]),
  "max-height": sizeCheck(MAX_SIZE_KEYWORDS, ["size", "calc-size-max"]),
  left: insetCheck,
  top: insetCheck,
  right: insetCheck,
  bottom: insetCheck,
  "margin-left": marginCheck,
  "margin-inline-start": marginCheck,
  margin: shorthand(
    (t) => t === "auto" || isLengthPct(t) || unreadableLenFn(t, ["size"]),
  ),
  transform: (v: string, toks: string[]) =>
    (toks.length === 1 && toks[0] === "none") ||
    fnListOk(v, TRANSFORM_FNS, false),
  filter: (v: string, toks: string[]) =>
    (toks.length === 1 && toks[0] === "none") || fnListOk(v, FILTER_FNS, true),
  scale: (_v: string, toks: string[]) =>
    (toks.length === 1 && toks[0] === "none") ||
    (toks.length >= 1 && toks.length <= 3 && toks.every(isNumOrPct)),
  /** `none | <lenpct> [ <lenpct> <length>? ]?` — 셋째(z)는 **길이**다. */
  translate: (_v: string, toks: string[]) => {
    if (toks.length === 1 && toks[0] === "none") return true;
    if (toks.length < 1 || toks.length > 3) return false;
    if (!toks.slice(0, 2).every(isLengthPct)) return false;
    return toks.length < 3 || isLength(toks[2]);
  },
  clip: (_v: string, toks: string[]) => {
    if (toks.length === 1 && toks[0] === "auto") return true;
    if (toks.length !== 1) return false;
    const call = callOf(toks[0]);
    if (call?.name !== "rect") return false;
    // `rect(0,0,0,0)` 도 `rect(0 0 0 0)` 도 쓴다
    const args = call.args.length === 1 ? cssTokens(call.args[0]) : call.args;
    return args.length === 4 && args.every((a) => a === "auto" || isLength(a));
  },
  "clip-path": (_v: string, toks: string[]) => {
    if (toks.length === 1 && toks[0] === "none") return true;
    // <clip-source> 는 **혼자만** 온다
    if (toks.length === 1 && isUrlToken(toks[0])) return true;
    if (toks.length < 1 || toks.length > 2) return false;
    let box = 0;
    let shape = 0;
    for (const t of toks) {
      if (SHAPE_BOXES.has(t)) box++;
      else if (basicShapeOk(t)) shape++;
      else return false;
    }
    return box <= 1 && shape <= 1;
  },
} satisfies Record<string, (v: string, toks: string[]) => boolean>;

/** `isTrackingPixel` 이 읽을 수 있는 속성 이름. */
type ReadableProp = keyof typeof VALIDATORS;

function keywordOrLengthPct(_v: string, toks: string[]): boolean {
  return toks.length === 1 && (toks[0] === "auto" || isLengthPct(toks[0]));
}

/** left·top·right·bottom — `anchor()` 도 받는 자리다. */
function insetCheck(v: string, toks: string[]): boolean {
  if (keywordOrLengthPct(v, toks)) return true;
  return toks.length === 1 && unreadableLenFn(toks[0], ["size", "side"]);
}

/** margin-left 무리 — `anchor()` 는 못 받고 `anchor-size()` 만 받는다. */
function marginCheck(v: string, toks: string[]): boolean {
  if (keywordOrLengthPct(v, toks)) return true;
  return toks.length === 1 && unreadableLenFn(toks[0], ["size"]);
}

/**
 * 이 값이 이 속성에 유효한가.
 *
 * 표에 없는 속성은 **어차피 안 읽으므로** 유효하다고 둔다 — 그 값은 map 에
 * 들어가기만 하고 아무도 꺼내 보지 않는다.
 */
function isValidValue(prop: string, value: string): boolean {
  const check = (VALIDATORS as Record<string, ((v: string, t: string[]) => boolean) | undefined>)[prop];
  if (!check) return true;
  if (value === "") return false;
  return check(value, cssTokens(value));
}

/**
 * CSS 길이를 픽셀 수로. 못 읽으면 null.
 *
 * **단위 없는 0 이 아닌 값은 무효다** — `width:5` 는 CSS 가 통째로 버리고
 * 브라우저는 본디 크기로 그린다(실측: 40×20 그림이 그대로 40×20). 앞에서는
 * 이걸 5px 로 읽었는데, 그러면 `style="width:1"` 이 붙은 **멀쩡한 그림**을
 * 픽셀로 오해해 막는다. 0 만은 단위가 무엇이든 0 이다.
 */
function cssLength(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const v = cssTrim(raw);
  // `calc` 만이 아니라 수학 함수 전부. 왜인지는 `evalMathLength` 주석에 있다.
  if (mathCall(v)) return evalMathLength(v);
  const p = unitOf(v);
  if (!p) return null;
  if (p.n === 0 && (p.unit === "" || p.unit === "%" || LENGTH_UNITS.has(p.unit))) {
    return 0;
  }
  const factor = ABSOLUTE_UNITS[p.unit];
  return factor === undefined ? null : p.n * factor;
}

/**
 * HTML `width`/`height` **속성** 값을 픽셀 수로.
 *
 * CSS 가 아니라 HTML 의 "rules for parsing dimension values" 다. 앞 공백을
 * 버리고 **숫자로 시작해야** 하며(부호는 못 온다), 소수점을 읽고, `%` 로
 * 끝나면 백분율이라 픽셀로 옮길 수 없다. 뒤에 붙은 찌꺼기는 무시한다.
 *
 * 실측(Chrome): `1junk`·`01`·`" 1"`·`1e0`·`1,5`·`1px` 은 전부 1px 로 그려지고,
 * `1.9`→1.9px, `1%`→그릇의 1%. **`+1` 과 `-1` 은 속성이 통째로 무시돼 본디
 * 크기(40×20)로 그려진다.** 앞 판의 보고서는 `+1` 도 1 로 읽힌다고 했는데
 * 재 보니 아니었다 — 그래서 여기서도 1 로 읽지 않는다. 1 로 읽었다면
 * `width="+1"` 이 붙은 멀쩡한 그림을 막게 된다.
 */
function htmlDimension(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const m = /^[ \t\n\f\r]*(\d+(?:\.\d+)?)(%?)/.exec(raw);
  if (!m || m[2] === "%") return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * 한 변이 이 이하면 그림이 담길 수 없다 — 담겨도 사람이 볼 것이 없다.
 * 이 규칙이 잘못 막는 것: `width="600" height="1"` 같은 **가로줄 그림**.
 * 표로 짠 옛 뉴스레터가 구분선에 쓰던 꼴이다. 잃는 것은 머리카락 한 줄이고,
 * 살리려면 1×N 픽셀(흔한 회피)을 통째로 열어 줘야 해서 그대로 둔다.
 */
const HAIRLINE_PX = 1;

/**
 * 두 변이 **다** 이 이하면 픽셀로 본다.
 *
 * 2×2 는 실제 추적 픽셀 상품에서 흔하다. 어디서 끊나 — 뉴스레터가 진짜로
 * 쓰는 가장 작은 그림은 글머리 점·모서리 조각인데 그것들이 4~10px 에서
 * 시작한다. 그래서 3 에서 끊는다. 4×4 부터는 안 막는다.
 */
const PIXEL_SIDE_PX = 3;

/**
 * 이보다 옅으면 없는 것으로 친다.
 *
 * 앞의 문턱은 0.05 라 `opacity:0.06` 이 그냥 지나갔다. 0.1 로 올린다 —
 * 워터마크처럼 **일부러 옅게** 쓰는 그림은 보통 0.1~0.3 이라 그 아래를
 * 막아도 잘못 막는 것이 없다. 0.1 자체는 남긴다(연한 배경 그림이 산다).
 */
const MIN_VISIBLE_OPACITY = 0.1;

/**
 * 화면 밖으로 밀어낸 것으로 보는 자리.
 *
 * 어떤 화면도 이만큼 넓지 않고, 디자인으로 쓰는 음수 위치는 자릿수가 다르다
 * (겹치기 −20px 쯤). 흔한 회피는 −9999px·−10000px 이다.
 */
const OFFSCREEN_PX = -1000;

/**
 * `clip-path` 가 상자를 통째로 잘라 내는가.
 *
 * 앞에서는 **첫 값이 50% 이상일 때만** 봐서, 자리만 옮긴 표기가 그냥
 * 지나갔다. 실측(Chrome)에서 아무것도 안 그려지는 것들:
 *   inset(0 50%) · inset(0px 50%) · inset(0 0 0 100%) · inset(50% 0 50% 0)
 *   circle(0) · ellipse(0 0)
 * 대조군(그려지는 것): inset(10%) · inset(0 10%) · circle(50%).
 *
 * 마주 보는 두 변의 잘라 냄이 합쳐 100% 이상이면 남는 넓이가 0 이다.
 * 백분율이 아닌 값(px·calc)은 그릇 크기를 알아야 뜻이 서므로 0 으로 친다 —
 * 모르면 막지 않는 쪽이다.
 */
function isFullyClipped(v: string | undefined): boolean {
  if (!v) return false;

  const inset = /^inset\(([^)]*)\)/.exec(v);
  if (inset) {
    // `round <반지름>` 뒤는 모서리 둥글기라 잘라 냄과 무관하다
    const parts = cssTokens(inset[1].split("round")[0]);
    if (!parts.length) return false;
    const pct = (s: string): number => {
      const p = unitOf(s);
      return p && p.unit === "%" ? p.n : 0;
    };
    // 1~4 값 축약: [모두] / [세로 가로] / [위 가로 아래] / [위 오른 아래 왼]
    const top = pct(parts[0]);
    const right = pct(parts[1] ?? parts[0]);
    const bottom = pct(parts[2] ?? parts[0]);
    const left = pct(parts[3] ?? parts[1] ?? parts[0]);
    return top + bottom >= 100 || left + right >= 100;
  }

  // `circle(0)`·`ellipse(0 0)` — 반지름이 0 이면 그릴 자리가 없다(실측).
  const round = /^(?:circle|ellipse)\(([^)]*)\)/.exec(v);
  if (round) {
    const first = cssTokens(round[1])[0] ?? "";
    return cssLength(first) === 0;
  }
  return false;
}

/**
 * `filter` 가 그림을 투명하게 만드는가.
 *
 * 실측: `filter:opacity(0)` · `filter:opacity(0%)` · `filter:grayscale(1)
 * opacity(0)` 이 전부 안 보인다. `opacity` 속성과 **같은 뜻을 다른 이름으로**
 * 적은 것이라 문턱도 같이 쓴다. `grayscale`·`blur` 같은 나머지 필터는 그림을
 * 바꿀 뿐 지우지 않아 보지 않는다.
 */
function filterOpacity(v: string | undefined): number | null {
  if (!v) return null;
  const m = /\bopacity\(([^)]*)\)/.exec(v);
  if (!m) return null;
  const p = unitOf(cssTrim(m[1]));
  if (!p) return null;
  return p.unit === "%" ? p.n / 100 : p.unit === "" ? p.n : null;
}

/** 옛 `clip:rect(0,0,0,0)` — "눈에는 안 보이되 읽기 도구에는 남긴다" 의 관용구. */
function isZeroRect(v: string | undefined): boolean {
  if (!v) return false;
  const m = /^rect\(([^)]*)\)/.exec(v);
  if (!m) return false;
  const parts = m[1].split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = cssLength(p);
    return n !== null && Math.abs(n) <= 1;
  });
}

/**
 * 크기를 0 으로 만드는가 — `transform:scale…()` 과 `scale` 속성 둘 다.
 *
 * 앞의 정규식(`0*(?:\.0+)?`)은 0 을 **적는 법 하나**만 알아서 `scale(0e0)` ·
 * `scale(0%)` 이 지나갔다(실측: 둘 다 0×0). 여기서는 CSS 숫자 문법으로 읽어
 * 표기가 달라도 같은 값으로 본다. 따로 있는 `scale:0` 속성도 실측에서
 * 0×0 이라 함께 본다.
 *
 * `scaleZ` 는 평면 크기를 안 바꾸므로 뺀다. `matrix(…)` 는 여전히 안 본다 —
 * 여섯 값을 제대로 곱해야 넓이가 0 인지 알 수 있어서, 근거 없이 막느니
 * 놓치는 쪽을 골랐다.
 */
function isZeroScale(
  transform: string | undefined,
  scaleProp: string | undefined,
): boolean {
  const zero = (raw: string): boolean => {
    const p = unitOf(cssTrim(raw));
    // 실측: `scale(0%)` 도 0 이다. 그 밖의 단위는 scale 이 안 받는다.
    return !!p && p.n === 0 && (p.unit === "" || p.unit === "%");
  };

  if (scaleProp && cssTokens(scaleProp).slice(0, 2).some(zero)) {
    return true;
  }
  if (!transform) return false;

  const re = /\bscale(3d|x|y|z)?\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(transform)) !== null) {
    if (m[1] === "z") continue;
    const args = m[2].split(",");
    // scale3d 의 셋째는 z 다 — 앞의 둘만 평면 크기를 정한다
    if ((m[1] === "3d" ? args.slice(0, 2) : args).some(zero)) return true;
  }
  return false;
}

/**
 * 화면 밖으로 밀어냈는가 — `position` 을 안 쓴 길들.
 *
 * 결과가 같으면 판정도 같아야 한다. 실측(Chrome)에서 **정말 움직이는 것**만
 * 넣었다. 40×20 그림이 x=8 에 있을 때:
 *   margin-left:-9999px          → x=-9991   (움직인다)
 *   margin-inline-start:-9999px  → x=-9991   (움직인다)
 *   margin:-9999px               → x=-9991   (움직인다)
 *   margin:0 0 0 -9999px         → x=-9991   (움직인다)
 *   transform:translate(-9999px) → x=-9991   (translateX·translate3d 도 같다)
 *   transform:translateY(-9999px)→ y=-8151   (움직인다)
 *   translate:-9999px (속성)      → x=-9991   (움직인다)
 *
 * **안 넣은 것 — 실측에서 한 뼘도 안 움직였다.** 넣었다면 멀쩡한 그림을
 * 막을 뻔했다:
 *   margin-top:-9999px · margin-bottom · margin:-9999px 0  (inline 상자라
 *     세로 margin 이 자리를 안 바꾼다)
 *   margin-right:-9999px  (뒤따르는 내용만 당긴다)
 *   position:sticky;left:-9999px
 *   transform:translate(-100%)  → x=-32. 백분율은 제 넓이만큼만 움직여
 *     화면 안에 남는다. 그래서 **절대 길이로 읽히는 값만** 본다.
 */
function isPushedOffscreen(
  at: (prop: ReadableProp) => string | undefined,
): boolean {
  const far = (raw: string | undefined): boolean => {
    const n = cssLength(raw);
    return n !== null && n <= OFFSCREEN_PX;
  };

  if (far(at("margin-left")) || far(at("margin-inline-start"))) return true;

  const margin = at("margin");
  if (margin) {
    const v = cssTokens(margin);
    // 1~4 값 축약에서 왼쪽 자리는 [모두] / [가로] / [가로] / [넷째]
    if (far(v.length >= 4 ? v[3] : v.length >= 2 ? v[1] : v[0])) return true;
  }

  const translate = at("translate");
  if (translate && cssTokens(translate).slice(0, 2).some((p) => far(p))) {
    return true;
  }

  const transform = at("transform");
  if (transform) {
    const re = /\btranslate(3d|x|y)?\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(transform)) !== null) {
      // 셋째 인자(z)는 평면 자리를 안 옮긴다
      if (m[2].split(",").slice(0, 2).some((a) => far(a))) return true;
    }
  }
  return false;
}

/** 두 값 중 **작은 쪽**. 한쪽만 알면 그것. 둘 다 모르면 모름. */
function smaller(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * 한 변의 크기. **CSS 가 속성을 이긴다.**
 *
 * 실측: `<img width="1" style="width:600px">` 은 600px 로 그려진다. 그래서
 * CSS 쪽에 값이 남아 있으면 — 그것이 `50%`·`auto` 처럼 우리가 픽셀로 옮기지
 * 못하는 값이어도 — 속성 값으로 되돌아가지 않는다. 되돌아가면
 * `<img width="1" style="width:100%">` 같은 멀쩡한 그림을 막게 된다.
 *
 * 여기 오는 `css` 는 이미 **유효한 선언만 남긴** 값이다(parseInlineStyle).
 * 무효한 값(`width:5`·`width:zzz`)은 애초에 map 에 없어 `undefined` 로 오고,
 * 그때만 속성을 본다 — 브라우저가 하는 것과 같다(실측: `<img width="1"
 * style="width:zzz">` 은 1px).
 *
 * 못 읽는 값(`UNREADABLE`)도 **값이 있는 것**이다. 실측: `<img width="1"
 * style="width:var(--없는것)">` 은 40×20 으로 그려진다 — 못 푼 var 는 초깃값
 * `auto` 가 되고, 그것이 속성이 주는 힌트를 이긴다. 속성으로 되돌아갔다면
 * 이 그림을 1px 로 오해했을 것이다.
 */
function sideOf(css: string | undefined, attr: string | undefined): number | null {
  if (css !== undefined) return cssLength(css);
  return htmlDimension(attr);
}

/**
 * 이 `img` 는 사람에게 보이려고 있는 것이 아니다 — 열었다는 사실을 알리려고 있다.
 *
 * **여기가 정제 전이라는 것이 핵심이다.** allowedStyles 에는
 * display·visibility·opacity·width·height 가 없어서, 정제가 끝난 HTML 에는
 * 이 판정의 근거가 남아 있지 않다. transformTags 콜백이 받는 attribs 는
 * 원본 그대로라 `style` 문자열이 살아 있다. 판정을 뒤로 미루면 아무것도 안
 * 걸리면서 잘 도는 것처럼 보인다.
 *
 * ── 못 보는 것 (구조적으로) ──
 * - `<style>` 블록·외부 시트로 숨긴 픽셀. 그 블록은 sanitize 가 내용째 지우고
 *   여기서는 애초에 보이지 않는다.
 * - 부모가 숨기는 것(`<div style="display:none"><img …></div>`). 여기서 보는
 *   것은 그 `img` 한 태그의 속성뿐이다.
 * - 아무 표시 없는 1×1 그림. 크기를 알려면 바이트를 받아 봐야 하는데, 받는
 *   순간 발신자에게 신호가 간다 — 그걸 막으려고 여기 있는 판정이다.
 * - **0 은 아니지만 사실상 0 인 것들.** 우리는 "0 이냐" 만 보는데, 브라우저는
 *   그린 뒤의 크기로 보인다/안 보인다가 갈린다. 실측(Chrome, 40×20 그림):
 *     transform:scale(1e-10) → 0×0 · scale(0.0001) → 0.004×0.002
 *     zoom:0.001            → 0.09×0.09   (`zoom:0` 은 Chrome 이 버린다)
 *   문턱을 하나 정해 막을 수도 있지만, 얼마나 작아야 안 보이는지는 **그림의
 *   본디 크기**에 달렸고 그것은 바이트를 받아야 안다. 어느 문턱을 골라도 바로
 *   그 아래·위로 적으면 그만이라, 근거 없이 막느니 놓치는 쪽을 골랐다
 *   (`matrix(…)` 와 같은 이유다).
 * - `clip-path:polygon(0 0,0 0,0 0)` 처럼 **넓이 0 인 다각형.** 실측에서
 *   상자는 40×20 인데 아무것도 안 칠한다. `inset`/`circle`/`ellipse` 는 보지만
 *   polygon 의 넓이는 안 잰다.
 * (그래도 그림은 우리 서버를 거쳐 나가므로 발신자가 얻는 것은 열람 시각과
 *  우리 서버 IP 뿐이고, 읽는 사람의 IP·UA 는 아니다.)
 */
function isTrackingPixel(attribs: Record<string, string>): boolean {
  if ("hidden" in attribs) return true;

  const style = parseInlineStyle(attribs.style);
  /*
   * **`ReadableProp` 로 묶은 것이 요점이다.** 유효성 검사가 없는 속성을 읽으면
   * 그 속성만 "마지막이 이긴다" 로 돌아가고, 그 자리가 곧 A 의 우회다.
   * 타입이 막으므로 표(VALIDATORS)에 없는 이름은 여기서 못 읽는다.
   */
  const at = (prop: ReadableProp) => style.get(prop);

  // ── 아예 그리지 않는 것들 ──
  if (at("display") === "none") return true;
  const visibility = at("visibility");
  if (visibility === "hidden" || visibility === "collapse") return true;

  const opacity = at("opacity");
  if (opacity !== undefined) {
    // `opacity:6%` 는 0.06 이다(실측). `parseFloat` 로 읽으면 6 이 돼 그냥
    // 지나간다 — 여기도 표기만 바꿔 뒤집는 자리라서 단위를 본다.
    const p = unitOf(opacity);
    const n =
      p === null ? null : p.unit === "%" ? p.n / 100 : p.unit === "" ? p.n : null;
    if (n !== null && n < MIN_VISIBLE_OPACITY) return true;
  }

  // `filter:opacity(0)` 은 opacity 를 다른 이름으로 적은 것이다(실측: 안 보임).
  const fo = filterOpacity(at("filter"));
  if (fo !== null && fo < MIN_VISIBLE_OPACITY) return true;

  // `content-visibility:hidden` 은 replaced 요소의 내용을 안 그린다 —
  // 실측에서 상자가 0×0 이 된다.
  if (at("content-visibility") === "hidden") return true;

  // ── 그리되 보이지 않게 하는 것들 ──
  if (isFullyClipped(at("clip-path"))) return true;
  if (isZeroScale(at("transform"), at("scale"))) return true;
  if (isPushedOffscreen(at)) return true;

  const position = at("position");
  // `relative` 를 더했다 — 실측에서 `position:relative;left:-9999px` 는
  // x=-9991, `top:-9999px` 는 y=-8071 로 화면 밖에 나간다. `sticky` 는
  // 제자리에 그대로라(실측) 넣지 않았다.
  if (position === "absolute" || position === "fixed" || position === "relative") {
    // `left:-9999px` 는 **자리를 잡은 것**에만 듣는다. position 없이 적힌
    // 값은 아무 일도 안 하므로(실측: 제자리에 그대로 그려진다) 여기서만 본다.
    if (isZeroRect(at("clip"))) return true;
    for (const edge of ["left", "top", "right", "bottom"] as const) {
      const n = cssLength(at(edge));
      if (n !== null && n <= OFFSCREEN_PX) return true;
    }
  }

  // ── 크기 ──
  // max-width/max-height 도 함께 본다 — `max-width:0` 은 width 를 무엇으로
  // 적었든 넓이를 0 으로 만든다(실측). `max-width:100%` 는 백분율이라
  // 읽어 내지 못하고, 그래서 아무 영향도 주지 않는다.
  const w = smaller(
    sideOf(at("width"), attribs.width),
    cssLength(at("max-width")),
  );
  const h = smaller(
    sideOf(at("height"), attribs.height),
    cssLength(at("max-height")),
  );

  if (w === 0 || h === 0) return true;
  if (w !== null && w <= HAIRLINE_PX) return true;
  if (h !== null && h <= HAIRLINE_PX) return true;
  if (w !== null && h !== null && w <= PIXEL_SIDE_PX && h <= PIXEL_SIDE_PX) {
    return true;
  }
  return false;
}

type Scheme = "http" | "cid" | "data" | "other";

function schemeOf(src: string): Scheme {
  const v = src.trim().toLowerCase();
  if (v.startsWith("http://") || v.startsWith("https://")) return "http";
  // 스킴 없는 `//host/x.png`. sanitize-html 의 allowProtocolRelative 기본값이
  // true 라 그냥 두면 브라우저가 발신자 서버를 그대로 부른다.
  if (v.startsWith("//")) return "http";
  if (v.startsWith("cid:")) return "cid";
  if (v.startsWith("data:")) return "data";
  return "other";
}

/** RFC 2392 는 cid 안의 특수문자를 퍼센트 인코딩하도록 한다. `<>` 도 벗긴다. */
function cidOf(src: string): string {
  let v = src.trim().slice("cid:".length);
  try {
    v = decodeURIComponent(v);
  } catch {
    /* 반쯤 인코딩된 값은 그대로 견준다 */
  }
  return v.replace(/^</, "").replace(/>$/, "");
}

/** 그림을 하나도 살리지 않는 정책 — 주소를 만들 문맥이 없는 자리에서. */
const KEEP_NOTHING: EmailImagePolicy = {
  resolveCid: () => null,
  proxyRemote: () => null,
};

export function sanitizeEmailHtml(
  html: string,
  policy: EmailImagePolicy = KEEP_NOTHING,
): SanitizedEmail {
  let blockedTrackers = 0;
  let proxiedImages = 0;
  const usedCids = new Set<string>();

  const out = sanitizeHtml(html, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "blockquote", "p", "a", "ul", "ol", "nl", "li",
      "b", "i", "strong", "em", "strike", "code",
      "hr", "br", "div", "span", "table", "thead", "caption",
      "tbody", "tr", "th", "td", "pre", "img", "figure", "figcaption",
      "sub", "sup", "small", "u",
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel", "title"],
      img: ["src", "alt", "title", "width", "height"],
      "*": ["style", "class"],
      table: ["border", "cellpadding", "cellspacing", "width"],
      td: ["colspan", "rowspan", "align", "valign", "width"],
      th: ["colspan", "rowspan", "align", "valign", "width"],
    },
    /*
     * `data` 와 `cid` 를 전역에서 뺐다.
     *
     * 전역에 있으면 `<a href="data:text/html;base64,…">` 와 `<a href="cid:…">`
     * 까지 통과한다 — img 만 따로 열어 둔 allowedSchemesByTag 의 뜻과 어긋난다.
     * img 의 `data:` 는 아래에서 여전히 허용한다(보관본이 그림을 몸에 굽는 길).
     */
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    /*
     * 스킴 없는 `//host/x.png` 를 막는다. 기본값 true 로는 그대로 통과해
     * 브라우저가 발신자 서버를 직접 부른다. (img 는 아래 변환이 먼저 잡지만,
     * `a` 와 앞으로 늘어날 태그를 위해 옵션 쪽도 닫아 둔다.)
     */
    allowProtocolRelative: false,
    /*
     * 위 DROP 이 만든 `src` 없는 img 를 결과에서 들어낸다.
     *
     * 여기서 지우면 여는 태그까지 잘려 나가 아무 흔적이 안 남는다. 발신자가
     * 원래부터 `src` 없이 보낸 img 도 같이 사라지는데, 그것도 어차피 그릴 것이
     * 없는 태그라 결과는 같다.
     */
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
    allowedStyles: {
      "*": {
        color: [/^.*$/],
        "background-color": [/^.*$/],
        "text-align": [/^left$|^right$|^center$|^justify$/],
        "font-size": [/^.*$/],
        "font-weight": [/^.*$/],
        "font-style": [/^.*$/],
        "text-decoration": [/^.*$/],
        margin: [/^.*$/],
        padding: [/^.*$/],
        border: [/^.*$/],
      },
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
      }),
      /*
       * 그림의 주소를 갈아끼우는 유일한 자리.
       *
       * 여기서 바꾸면 캐시(message_body_cache)·보관 사본(archived_messages)·
       * 화면이 전부 같은 값을 쓴다. 정제된 HTML 이 곧 계약이라 하류에 손댈 곳이
       * 없다 — 반대로 말하면 여기서 굳힌 주소가 그대로 디스크에 남는다.
       */
      img: (tagName, attribs) => {
        const src = attribs.src?.trim();
        if (!src) return DROP;

        const scheme = schemeOf(src);

        // data: 는 이미 우리 문서 안에 있는 바이트다 — 밖으로 나가는 요청이
        // 없으니 추적할 수단도 없고, 프록시로 바꿀 이유도 없다. 그대로 둔다.
        if (scheme === "data") return { tagName, attribs };

        if (scheme === "cid") {
          const cid = cidOf(src);
          usedCids.add(cid);
          const to = policy.resolveCid(cid);
          return to ? { tagName, attribs: { ...attribs, src: to } } : DROP;
        }

        if (scheme === "http") {
          // **주소를 바꾸기 전에** 판정한다. 바꾼 뒤에 걸러도 될 것 같지만,
          // 판정 근거(style)는 이 콜백을 벗어나는 순간 사라진다.
          if (isTrackingPixel(attribs)) {
            blockedTrackers++;
            return DROP;
          }
          const to = policy.proxyRemote(
            src.startsWith("//") ? `https:${src}` : src,
          );
          if (!to) return DROP;
          proxiedImages++;
          return { tagName, attribs: { ...attribs, src: to } };
        }

        // 메일 본문에는 기준 주소가 없다. 상대 경로 그림은 어차피 뜨지 않고,
        // 남겨 두면 **우리 오리진**의 아무 경로나 가리키게 된다.
        return DROP;
      },
    },
  });

  return { html: out, blockedTrackers, proxiedImages, usedCids };
}

/** plain text 를 안전한 HTML 로 (줄바꿈 보존, URL 자동링크 안 함). */
export function plainTextToSafeHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `<pre style="white-space: pre-wrap; word-break: break-word; font-family: inherit; margin: 0;">${escaped}</pre>`;
}
