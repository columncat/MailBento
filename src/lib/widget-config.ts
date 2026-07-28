/**
 * 날씨 코드 → 이모지.
 *
 * 지역 목록은 여기 있지 않다 — 설정에서 편집하고 app_config 에 저장한다
 * (lib/regions.ts). 예전에는 이 파일에 하드코딩된 배열이었고, 나라별 지도
 * 이미지와 손으로 계산한 마커 좌표까지 들고 있었지만 어디에서도 그리지 않는
 * 죽은 값이었다.
 */

export function wttrEmoji(code: string | number, isDay: boolean): string {
  const c = typeof code === "string" ? parseInt(code, 10) : code;
  if (Number.isNaN(c)) return "·";
  if (c === 113) return isDay ? "☀" : "🌙";
  if (c === 116) return isDay ? "⛅" : "☁";
  if (c === 119 || c === 122) return "☁";
  if (c === 143 || c === 248 || c === 260) return "🌫";
  if (
    [
      176, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 317, 320,
      353, 356, 359,
    ].includes(c)
  )
    return "🌧";
  if (
    [
      179, 182, 185, 227, 230, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368,
      371, 374, 377,
    ].includes(c)
  )
    return "🌨";
  if ([200, 386, 389, 392, 395].includes(c)) return "⛈";
  return "·";
}
