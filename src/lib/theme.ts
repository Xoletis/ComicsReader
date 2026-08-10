import { applyThemeColors, BUILT_IN_THEMES, ThemeFile } from "./themeFile";

const STORAGE_KEY = "cbreader:activeTheme";

// The full theme (not just an id) is cached, not just which one was picked —
// a custom theme's source file might live on a folder that isn't reconnected
// yet on this launch (or ever again), but the app should still open looking
// the way it did last time instead of flashing back to the dark default
// while that folder access gets sorted out (or never does).
export function loadActiveTheme(): ThemeFile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ThemeFile;
  } catch {
    // fall through to default
  }
  return BUILT_IN_THEMES.find((t) => t.id === "dark") ?? BUILT_IN_THEMES[0];
}

export function saveActiveTheme(theme: ThemeFile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
  }
}

export function applyTheme(theme: ThemeFile): void {
  applyThemeColors(theme.colors);
}
