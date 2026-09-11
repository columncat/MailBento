/**
 * ── imapflow 의 오류에서 **서버가 실제로 한 말**을 꺼낸다 ──
 *
 * 왜 이 파일이 있나. `err.message` 는 거의 언제나 `Command failed` 다 —
 * imapflow 가 태그 붙은 `NO`/`BAD` 를 받으면 **명령 종류와 무관하게** 그
 * 한 문장을 던진다(`imap-flow.js` 의 `new Error('Command failed')`). 우리는
 * 그 한 문장만 로그에 찍고 있었고, 그래서 운영에서 메일 네 통이 안 열렸을 때
 * **19시간 동안 원인을 몰랐다.** 서버가 뭐라고 했는지, 어느 명령이 죽었는지가
 * 오류 객체에 이미 붙어 있는데 우리가 안 본 것뿐이다.
 *
 * 실제로 붙어 있는 것(FETCH 오류에서 실측):
 *   responseStatus  "NO" | "BAD"
 *   responseText    "Internal error occurred. Refer to server log for …"
 *   executedCommand "9 UID FETCH 201 (UID FLAGS … BODY.PEEK[]<0.131072>)"
 *   response.attributes[0].section[0].value  "SERVERBUG"  ← 응답 코드가 사는 곳
 *
 * **`serverResponseCode` 는 FETCH 오류에 안 붙는다.** `tools.enhanceCommandError`
 * 를 부르는 것은 login·authenticate·create·append 래퍼뿐이고 `commands/fetch.js`
 * 는 안 부른다. 그래서 응답 코드는 위 `section` 에서 손수 꺼낸다. (붙어 있는
 * 경우도 있으니 그쪽도 본다.)
 *
 * 여기서 나온 글자는 **로그에만** 쓴다. 서버가 정하는 문자열이라 길이를 자르고
 * 줄바꿈·제어문자를 지운다 — 남이 우리 로그를 여러 줄로 어지럽히지 못하게.
 */

/** 로그 한 줄에 들어갈 만큼만. 서버가 정하는 값이라 상한이 필요하다. */
const MAX_TEXT = 200;
const MAX_CMD = 240;

function tidy(v: unknown, max: number): string {
  if (typeof v !== "string" || !v) return "";
  // 제어문자(줄바꿈 포함)를 지운다 — 로그 한 줄은 한 줄이어야 한다
  const flat = v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * `NO`/`BAD` 응답에 붙는 **응답 코드**(`[SERVERBUG]`, `[TRYCREATE]` …).
 * imapflow 가 파싱해 둔 attributes 안 `section` 에 들어 있다.
 */
function responseCodeOf(err: Record<string, unknown>): string {
  const direct = tidy(err.serverResponseCode, 40);
  if (direct) return direct;
  const res = err.response as { attributes?: unknown } | undefined;
  const attrs = Array.isArray(res?.attributes) ? res.attributes : [];
  for (const a of attrs) {
    const section = (a as { section?: unknown })?.section;
    if (!Array.isArray(section) || !section.length) continue;
    const v = tidy((section[0] as { value?: unknown })?.value, 40);
    if (v) return v;
  }
  return "";
}

/**
 * 로그 한 줄에 넣을 사연. 예:
 *
 *   NO [SERVERBUG] "Internal error occurred." cmd="UID FETCH 201 (…)"
 *
 * imapflow 오류가 아니면 그냥 메시지를 돌려준다 — 부르는 쪽이 갈래를 따질
 * 필요가 없어야 이 함수를 쓴다.
 */
export function imapErrorDetail(err: unknown): string {
  if (!(err instanceof Error)) return tidy(String(err), MAX_TEXT) || "unknown";
  const e = err as unknown as Record<string, unknown>;

  const status = tidy(e.responseStatus, 10);
  const text = tidy(e.responseText, MAX_TEXT);
  const code = responseCodeOf(e);
  // 태그를 뗀다 — "9 UID FETCH …" 의 앞 숫자는 왕복마다 달라 로그를 비교할 때
  // 방해만 된다. 무슨 명령이었나만 남긴다.
  const cmd = tidy(e.executedCommand, MAX_CMD).replace(/^\S+\s+/, "");

  if (!status && !text && !cmd) {
    // imapflow 가 아닌 오류(우리가 던진 것·소켓 오류 …)
    const own = tidy(err.message, MAX_TEXT) || err.name || "unknown";
    const kind = tidy(e.code, 40);
    /*
     * 우리가 사람에게 보일 우리말로 갈아 던질 때 원래 오류를 `cause` 에
     * 매달아 둔다. 그래야 화면에는 짧은 우리말이 가고 **로그에는 서버가 한
     * 말이 그대로 남는다** — 둘 중 하나만 고르면 이번 사고가 되풀이된다.
     */
    const cause = err.cause;
    if (cause instanceof Error) {
      const deeper = imapErrorDetail(cause);
      if (deeper && deeper !== own) return `${own} ← ${deeper}`;
    }
    return kind ? `${own} (${kind})` : own;
  }

  const parts: string[] = [];
  if (status) parts.push(status);
  if (code) parts.push(`[${code}]`);
  parts.push(text ? `"${text}"` : `"${tidy(err.message, MAX_TEXT)}"`);
  if (cmd) parts.push(`cmd="${cmd}"`);
  return parts.join(" ");
}
