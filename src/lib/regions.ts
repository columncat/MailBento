/**
 * 시계 위젯의 지역.
 *
 * 사용자가 넣는 것은 **이름 · 위경도 · 표준시 · 단위** 뿐이다. 화면에 필요한
 * 나머지(좌표 표기, 타임존 라벨, 날씨 조회 키)는 전부 여기서 파생한다 —
 * 손으로 적게 두면 위경도를 바꿨을 때 표기만 옛 값으로 남는다.
 */

export const REGION_LOCALES = ["ko-KR", "en-US"] as const;
export type RegionLocale = (typeof REGION_LOCALES)[number];

export const TEMP_UNITS = ["C", "F"] as const;
export type TempUnit = (typeof TEMP_UNITS)[number];

/** 저장되는 값. */
export interface RegionInput {
  id: string;
  /** 화면에 뜨는 이름. */
  label: string;
  /** 좌측 위 배지 (국가코드 등 2~3글자). 비우면 표준시에서 추측한다. */
  badge?: string;
  lat: number;
  lng: number;
  /** IANA 표준시 (예: Asia/Seoul). */
  tz: string;
  unit: TempUnit;
  locale: RegionLocale;
}

/** 화면이 쓰는 값 — 파생 필드까지 채워진 것. */
export interface Region extends RegionInput {
  badge: string;
  /** "37.5°N · 127.0°E" */
  coords: string;
  /** 표준시 약칭과 UTC 오프셋. "EDT -4" / (약칭이 없으면) "UTC +9". */
  tzLabel: string;
  /** wttr.in 조회 키. 위경도를 그대로 쓴다 — 도시명 철자에 기대지 않는다. */
  weatherQuery: string;
}

/**
 * 설정이 비어 있을 때 쓰는 값.
 *
 * 예전에 하드코딩돼 있던 두 지역을 그대로 옮겼다. 하나로 줄이면 이미 쓰던
 * 사람의 두 번째 시계가 업데이트만으로 말없이 사라진다.
 */
export const DEFAULT_REGIONS: RegionInput[] = [
  {
    id: "seoul",
    label: "서울",
    badge: "KR",
    lat: 37.5665,
    lng: 126.978,
    tz: "Asia/Seoul",
    unit: "C",
    locale: "ko-KR",
  },
  {
    id: "lafayette",
    label: "West Lafayette, IN",
    badge: "US",
    lat: 40.4259,
    lng: -86.9081,
    tz: "America/Indiana/Indianapolis",
    unit: "F",
    locale: "en-US",
  },
];

/** 한 화면에 둘 수 있는 최대 개수. 넘으면 시계가 읽을 수 없이 좁아진다. */
export const MAX_REGIONS = 4;

function fmtCoord(v: number, pos: string, neg: string): string {
  return `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;
}

/**
 * 표준시 약칭과 UTC 오프셋.
 *
 * Intl 이 주는 약칭은 지역에 따라 "GMT+9" 처럼 나오기도 한다. 그때는 오프셋만
 * 남기고 약칭을 붙이지 않는다 — "GMT+9 +9" 는 같은 말을 두 번 하는 셈이다.
 */
export function tzLabelOf(tz: string, at: Date = new Date()): string {
  let abbr = "";
  let offsetMin = 0;
  try {
    abbr =
      new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    // 그 지역의 벽시계와 UTC 벽시계의 차이 = 오프셋
    const local = new Date(at.toLocaleString("en-US", { timeZone: tz }));
    const utc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
    offsetMin = Math.round((local.getTime() - utc.getTime()) / 60000);
  } catch {
    return tz;
  }
  const sign = offsetMin >= 0 ? "+" : "-";
  const h = Math.floor(Math.abs(offsetMin) / 60);
  const m = Math.abs(offsetMin) % 60;
  const off = `${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
  return /^GMT|^UTC/.test(abbr) ? `UTC ${off}` : `${abbr} ${off}`;
}

/** 표준시 문자열에서 배지를 추측한다 (Asia/Seoul → ASIA). 어디까지나 폴백. */
function guessBadge(tz: string): string {
  const head = tz.split("/")[0] ?? "";
  return head.slice(0, 4).toUpperCase() || "TZ";
}

export function toRegion(input: RegionInput, at: Date = new Date()): Region {
  return {
    ...input,
    badge: (input.badge || guessBadge(input.tz)).slice(0, 4),
    coords: `${fmtCoord(input.lat, "N", "S")} · ${fmtCoord(input.lng, "E", "W")}`,
    tzLabel: tzLabelOf(input.tz, at),
    // 소수점 4자리면 10m 남짓이라 날씨 격자에는 넘치도록 충분하다
    weatherQuery: `${input.lat.toFixed(4)},${input.lng.toFixed(4)}`,
  };
}

/** 표준시 문자열이 이 런타임에서 실제로 쓸 수 있는가. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format();
    return true;
  } catch {
    return false;
  }
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * 저장·전송된 값을 안전한 목록으로. 못 쓰면 기본값.
 *
 * 하나라도 살릴 수 있으면 살린다 — 항목 하나가 깨졌다고 전체를 기본값으로
 * 되돌리면 나머지 지역 설정까지 말없이 사라진다.
 */
export function normalizeRegions(input: unknown): RegionInput[] {
  if (!Array.isArray(input)) return DEFAULT_REGIONS;
  const out: RegionInput[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<RegionInput>;
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const tz = typeof r.tz === "string" ? r.tz : "";
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!isValidTimeZone(tz)) continue;
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : `r${out.length + 1}`,
      label: label.slice(0, 24),
      badge: typeof r.badge === "string" ? r.badge.trim().slice(0, 4) : "",
      lat: clamp(lat, -90, 90),
      lng: clamp(lng, -180, 180),
      tz,
      unit: r.unit === "F" ? "F" : "C",
      locale: r.locale === "en-US" ? "en-US" : "ko-KR",
    });
    if (out.length >= MAX_REGIONS) break;
  }
  return out.length > 0 ? out : DEFAULT_REGIONS;
}
