/**
 * 인증이 켜져 있는가, 일부러 꺼 두었는가, 아니면 설정이 빠졌는가.
 *
 * 예전에는 `AUTH_PASSWORD` 가 비어 있으면 그대로 **문을 열었다**(fail-open).
 * 설치 마법사의 "비밀번호 없이" 를 받으려던 것인데, 그러면 설정 파일이 어떤
 * 이유로든(잘못 다시 쓴 파일, 빠진 줄, 다른 이름) 비밀번호 없이 읽히는 순간
 * 메일함 전체가 로그인 없이 열린다. 운영자는 아무 경고도 보지 못한다.
 *
 * 그래서 셋으로 나눈다.
 *
 *  - "on"  : 비밀번호와 세션 키가 둘 다 있다. 평소 모습.
 *  - "off" : 둘 중 하나가 없고, `AUTH_DISABLED=1` 이 **명시적으로** 적혀 있다.
 *            일부러 잠그지 않기로 한 설치(마법사에서 비밀번호를 비운 경우)다.
 *  - "misconfigured" : 둘 중 하나가 없는데 `AUTH_DISABLED=1` 도 없다.
 *            실수일 가능성이 크므로 **모든 요청을 거절한다**(503).
 *
 * 비밀번호만 있고 `AUTH_SECRET` 이 없으면 쿠키를 만들 수 없어 로그인 자체가
 * 터진다. 그것도 "misconfigured" 로 묶어 원인을 바로 말해 준다.
 *
 * 미들웨어(edge)에서도 부르므로 아무것도 import 하지 않는다. `process.env` 를
 * 직접 읽는다 — 빌드 시점이 아니라 **런타임에** 읽혀야 하는 값이라서다.
 */
export type AuthMode = "on" | "off" | "misconfigured";

export function authMode(): AuthMode {
  const hasPassword = !!process.env.AUTH_PASSWORD;
  const hasSecret = !!process.env.AUTH_SECRET;
  if (hasPassword && hasSecret) return "on";
  if (process.env.AUTH_DISABLED === "1") return "off";
  return "misconfigured";
}

/** 설정이 빠졌을 때 사람에게 보여 줄 한 줄. 값은 담지 않는다. */
export const AUTH_MISCONFIGURED_MESSAGE =
  "인증 설정이 없습니다 (AUTH_PASSWORD / AUTH_SECRET). " +
  "일부러 잠그지 않으려면 AUTH_DISABLED=1 을 명시하세요.";
