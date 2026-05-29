/**
 * 위젯 데이터 — localStorage 에 JSON 으로 통째 저장.
 * 단일 사용자 / NAS 환경 가정 — 동기화 안 함.
 */

export interface FolderLink {
  id: string;
  title: string;
  url: string;
  iconUrl: string;
}

export interface WidgetFolder {
  id: string;
  name: string;
  /** 최대 4개 (2×2 고정). */
  links: FolderLink[];
}

/** 폴더는 고정 3개 (추가/삭제 불가). */
export const FIXED_FOLDER_COUNT = 3;

const DEFAULT_FOLDER_NAMES = ["폴더 1", "폴더 2", "폴더 3"];

/** 항상 정확히 3개의 폴더가 존재하도록 패딩/절단. */
export function ensureFolders(folders: WidgetFolder[]): WidgetFolder[] {
  const out = folders.slice(0, FIXED_FOLDER_COUNT);
  while (out.length < FIXED_FOLDER_COUNT) {
    out.push({
      id: uid(),
      name: DEFAULT_FOLDER_NAMES[out.length] ?? "",
      links: [],
    });
  }
  return out;
}

export interface Pin {
  id: string;
  url: string;
  title: string;
  iconUrl: string;
}

export interface Memo {
  id: string;
  text: string;
  createdAt: number;
}

export interface WidgetState {
  folders: WidgetFolder[];
  pins: Pin[];
  memos: Memo[];
}

const STORAGE_KEY = "mailbento.widget.state";
export const WIDGET_ENABLED_KEY = "mailbento.widget.enabled";

const EMPTY_STATE: WidgetState = {
  folders: [],
  pins: [],
  memos: [],
};

export function loadWidgetState(): WidgetState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_STATE, folders: ensureFolders([]) };
    const parsed = JSON.parse(raw) as Partial<WidgetState>;
    return {
      folders: ensureFolders(
        Array.isArray(parsed.folders) ? parsed.folders : [],
      ),
      pins: Array.isArray(parsed.pins) ? parsed.pins : [],
      memos: Array.isArray(parsed.memos) ? parsed.memos : [],
    };
  } catch {
    return { ...EMPTY_STATE, folders: ensureFolders([]) };
  }
}

export function saveWidgetState(state: WidgetState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota, etc. — 무시 */
  }
}

export function loadWidgetEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(WIDGET_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveWidgetEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(WIDGET_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    /* */
  }
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** URL 의 hostname 추출 (실패하면 url 그대로). */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Google favicon 서비스로 favicon URL 자동 생성. */
export function autoIconUrl(url: string): string {
  const host = hostnameOf(url);
  return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
}
