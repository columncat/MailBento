/**
 * 위젯 헤더 설정 — 지역 (시계/날씨) + 주식.
 * 향후 사용자 편집 가능하게 확장할 수 있도록 한 곳에 모아둠.
 */

export interface Region {
  key: string;
  flag: string;
  city: string;
  cityKor: string;
  tz: string;
  /** 상단 라벨 (예: "KST +9", "EST -4"). */
  tzLabel: string;
  locale: string;
  lat: number;
  lng: number;
  coords: string;
  /** wttr.in 위치 query — 영문/도시명. */
  weatherQuery: string;
  /** 온도 단위. */
  unit: "C" | "F";
  /** 외부 국가 지도 이미지 URL (Wikimedia Commons location map). */
  mapImage: string;
  /** 마커 위치 (지도 이미지 가로/세로 비율 0~1). */
  markerX: number;
  markerY: number;
}

// Wikimedia Commons Special:FilePath — 해시 없이 안정적으로 원본으로 리다이렉트.
const KR_MAP =
  "https://commons.wikimedia.org/wiki/Special:FilePath/South_Korea_location_map.svg";
const US_MAP =
  "https://commons.wikimedia.org/wiki/Special:FilePath/Usa_edcp_location_map.svg";

export const REGIONS: Region[] = [
  {
    key: "seoul",
    flag: "KR",
    city: "Seoul",
    cityKor: "서울",
    tz: "Asia/Seoul",
    tzLabel: "KST +9",
    locale: "ko-KR",
    lat: 37.5665,
    lng: 126.978,
    coords: "37.5°N · 127.0°E",
    weatherQuery: "Seoul",
    unit: "C",
    mapImage: KR_MAP,
    // South Korea location map bounds: top 39.0 / bottom 33.0 / left 124.5 / right 130.0
    // Seoul 37.57N,126.98E → x=(126.98-124.5)/5.5, y=(39.0-37.57)/6.0
    markerX: 0.451,
    markerY: 0.239,
  },
  {
    key: "lafayette",
    flag: "US",
    city: "West Lafayette",
    cityKor: "West Lafayette, IN",
    tz: "America/Indiana/Indianapolis",
    tzLabel: "EST -4",
    locale: "en-US",
    lat: 40.4259,
    lng: -86.9081,
    coords: "40.4°N · 86.9°W",
    weatherQuery: "West+Lafayette",
    unit: "F",
    mapImage: US_MAP,
    // Usa_edcp location map bounds: top 49.38 / bottom 24.94 / left -124.85 / right -66.89
    // W.Lafayette 40.43N,86.91W → x=(-86.91+124.85)/57.96, y=(49.38-40.43)/24.44
    markerX: 0.655,
    markerY: 0.366,
  },
];

export interface StockDef {
  id: string;
  name: string;
  ticker: string;
  exchange: string;
  kind: "kr_index" | "kr_stock" | "fx";
  decimals: number;
}

export const STOCKS: StockDef[] = [
  {
    id: "KOSPI",
    name: "KOSPI",
    ticker: ".KS",
    exchange: "종합지수",
    kind: "kr_index",
    decimals: 2,
  },
  {
    id: "FX_USDKRW",
    name: "원/달러",
    ticker: "USD",
    exchange: "환율",
    kind: "fx",
    decimals: 2,
  },
  {
    id: "FX_JPYKRW",
    name: "원/엔(100)",
    ticker: "JPY",
    exchange: "환율",
    kind: "fx",
    decimals: 2,
  },
  {
    id: "005930",
    name: "삼성전자",
    ticker: "005930",
    exchange: "KRX",
    kind: "kr_stock",
    decimals: 0,
  },
  {
    id: "000660",
    name: "SK하이닉스",
    ticker: "000660",
    exchange: "KRX",
    kind: "kr_stock",
    decimals: 0,
  },
];

/** wttr.in weather code → emoji */
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

/** 외부 API 가 CORS 막혀있는 경우용 프록시 (Naver finance 등). */
export function proxied(url: string): string {
  return `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`;
}
