/**
 * 정적으로 잡히는 프롬프트 주입 흔적.
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
export const SUBJECT_LIMIT = 40;

export function clipSubject(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (!one) return "(제목 없음)";
  return one.length <= SUBJECT_LIMIT ? one : `${one.slice(0, SUBJECT_LIMIT)}…`;
}

/**
 * 보낸이 주소 가리기 — 앞 5글자와 뒤 10글자만.
 *
 * 주소 자체가 공격자가 정하는 문자열이다. 도메인 뒤쪽은 남겨서 어디서 온
 * 것인지는 알 수 있게 한다.
 */
export function maskEmail(raw: string): string {
  const one = raw.replace(/\s+/g, " ").trim();
  const at = one.lastIndexOf("@");
  const addr = at >= 0 ? one.slice(one.lastIndexOf("<") + 1).replace(/>$/, "") : one;
  if (addr.length <= 15) return addr;
  return `${addr.slice(0, 5)}…${addr.slice(-10)}`;
}
