/**
 * 정적으로 잡히는 프롬프트 주입 흔적. (앱의 lib/injection.ts 와 같은 규칙)
 *
 * 여기서 잡는 것은 **모호하지 않은 것만**이다. 사람이 쓴 메일 제목에 우연히
 * 들어갈 리 없는 표지들 — 울타리 태그를 흉내낸 것, 역할 표지, 모델 제어 토큰.
 *
 * "이전 지시를 무시하라" 같은 자연어까지 넣지 않는다. 그건 정상적인 문장에도
 * 들어갈 수 있고, 막아 봐야 표현을 조금 바꾸면 지나간다. **이 층은 값싼
 * 1차 거름망이지 방어선이 아니다.** 진짜 방어는 에이전트에게 도구를 주지 않고
 * 출력을 1비트로 묶은 쪽에 있다.
 */

interface Marker {
  name: string;
  re: RegExp;
}

const MARKERS: Marker[] = [
  // 우리가 씌우는 울타리를 흉내내 빠져나가려는 것
  { name: "울타리 태그", re: /<\/?\s*untrusted\s*>/i },
  // 채팅 형식을 흉내내 역할을 바꾸려는 것
  { name: "역할 표지", re: /^\s*(system|assistant|developer)\s*:/im },
  // 모델 제어 토큰
  { name: "제어 토큰", re: /<\|[a-z_]+\|>/i },
  { name: "제어 토큰", re: /\[\/?INST\]|<<\/?SYS>>/i },
  // 도구 호출을 흉내내는 것
  { name: "도구 호출 흉내", re: /<\/?(tool_call|function_call|antml:invoke)\b/i },
];

export interface Detection {
  marker: string;
  /** 어디서 걸렸는지 — 제목 / 보낸이. */
  field: string;
}

/** 걸리면 표지 이름, 아니면 null. */
export function detectInjection(
  fields: { field: string; value: string }[],
): Detection | null {
  for (const f of fields) {
    if (!f.value) continue;
    for (const m of MARKERS) {
      if (m.re.test(f.value)) return { marker: m.name, field: f.field };
    }
  }
  return null;
}

/**
 * 에이전트에게 줄 제목 길이.
 *
 * 짧을수록 주입에 쓸 수 있는 글자가 줄지만, 너무 짧으면 광고인지 사람이 쓴
 * 것인지 가릴 수 없어 판정 자체가 무의미해진다. **자르는 것이 안전을 만드는
 * 것이 아니다** — 한국어 40자면 주입 문장은 들어간다. 안전은 에이전트에게
 * 도구를 주지 않고 출력을 Y/N 한 글자로 묶은 쪽에서 온다.
 */
export const SUBJECT_LIMIT = 80;

export function clipSubject(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (!one) return "(제목 없음)";
  return one.length <= SUBJECT_LIMIT ? one : `${one.slice(0, SUBJECT_LIMIT)}…`;
}

/** 표시 이름 길이. 제목과 같은 성격의 자유 문자열이라 같이 자른다. */
const NAME_LIMIT = 30;

/**
 * 보낸이 가리기.
 *
 * 앞뒤로 잘라 내던 방식을 버렸다. 그 방식은 판정에 필요한 것만 골라 없애고
 * 위험한 것은 남겼다.
 *
 * - **표시 이름을 통째로 버렸다.** `MyISS vMISCi <noreply@…>` 가
 *   `norep…purdue.edu` 가 됐다. 어디서 왔는지 가장 잘 말해 주는 부분이다.
 * - **도메인을 잘라 오히려 속였다.** `zeiglersubaru.com` 이 `subaru.com` 이
 *   되어 대리점이 제조사처럼 보였고, `kaist.ac.kr` 은 `aist.ac.kr` 이라는
 *   없는 도메인이 됐다.
 *
 * 그래서 반대로 나눈다. 도메인은 **그대로** 남긴다 — DNS 가 쓸 수 있는 글자를
 * 정해 두므로 문장을 심을 자리가 아니고, 판정에는 가장 쓸모 있다. 자유롭게
 * 쓸 수 있는 쪽(계정 이름)은 앞 세 글자만 남긴다. 표시 이름은 제목과 같은
 * 성격이라 제목처럼 길이만 자른다.
 *
 * 자르는 것이 안전을 만드는 것이 아니다. 안전은 에이전트에게 도구를 주지 않고
 * 출력을 Y/N 한 글자로 묶은 쪽에서 온다.
 */
export function maskEmail(raw: string): string {
  const one = raw.replace(/\s+/g, " ").trim();
  if (!one) return "(보낸이 없음)";

  // `이름 <주소>` 와 `주소` 둘 다 온다.
  const open = one.lastIndexOf("<");
  const addr = (open >= 0 ? one.slice(open + 1).replace(/>$/, "") : one).trim();
  const rawName = open > 0 ? one.slice(0, open).trim().replace(/^"|"$/g, "") : "";
  const name = rawName.length > NAME_LIMIT ? `${rawName.slice(0, NAME_LIMIT)}…` : rawName;

  const at = addr.lastIndexOf("@");
  if (at <= 0) return name ? `${name} <${addr.slice(0, 40)}>` : addr.slice(0, 40);

  const local = addr.slice(0, at);
  // 도메인이 터무니없이 길면 그건 도메인이 아니라 실어 보낸 글이다.
  const domain = addr.slice(at + 1).slice(0, 60);
  const shownLocal = local.length <= 3 ? local : `${local.slice(0, 3)}…`;
  const shown = `${shownLocal}@${domain}`;

  return name ? `${name} <${shown}>` : shown;
}
