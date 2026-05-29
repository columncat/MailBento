/**
 * 클라이언트 사이드 표시 prefs — localStorage 에 보관.
 */

export const THEMES = [
  { key: "forest", label: "Forest", swatch: "oklch(0.78 0.14 145)" },
  { key: "ocean", label: "Ocean", swatch: "oklch(0.78 0.14 220)" },
  { key: "sunset", label: "Sunset", swatch: "oklch(0.79 0.16 55)" },
  { key: "lavender", label: "Lavender", swatch: "oklch(0.80 0.13 295)" },
  { key: "mono", label: "Mono", swatch: "oklch(0.88 0.008 250)" },
  { key: "rose", label: "Rose", swatch: "oklch(0.79 0.15 15)" },
] as const;

export type ThemeKey = (typeof THEMES)[number]["key"];
export const DEFAULT_THEME: ThemeKey = "forest";

export const MODES = ["dark", "light"] as const;
export type ModePref = (typeof MODES)[number];
export const DEFAULT_MODE: ModePref = "dark";

export const COLUMNS = ["auto", "1", "2", "3", "4"] as const;
export type ColumnsPref = (typeof COLUMNS)[number];
export const DEFAULT_COLUMNS: ColumnsPref = "auto";

export const STORAGE_KEYS = {
  theme: "mailbento.theme",
  mode: "mailbento.mode",
  columns: "mailbento.columns",
} as const;

export const COLUMN_CLASS: Record<ColumnsPref, string> = {
  auto: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
  "1": "grid-cols-1",
  "2": "grid-cols-1 md:grid-cols-2",
  "3": "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
  "4": "grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
};

export function applyThemeAndModeToHtml(theme: ThemeKey, mode: ModePref) {
  const root = document.documentElement;
  // 기존 theme-/mode- 클래스 제거
  Array.from(root.classList)
    .filter((c) => c.startsWith("theme-") || c.startsWith("mode-"))
    .forEach((c) => root.classList.remove(c));
  root.classList.add(`theme-${theme}`, `mode-${mode}`);
}
