import { isTauri } from "@tauri-apps/api/core";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, exists, mkdir, readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { BUILT_IN_THEMES, isValidThemeFile, ThemeFile } from "./themeFile";

const THEMES_DIR = "themes";

// Desktop-only: writing files to a fixed location without a user gesture each
// time isn't something a web page is allowed to do (and shouldn't be) — the
// plain web build just falls back to BUILT_IN_THEMES with no folder at all.
export function isThemesFolderSupported(): boolean {
  return isTauri();
}

// For display only (the "here's where to drop a theme file" hint in the UI)
// — every actual read/write below goes through BaseDirectory.AppConfig
// instead of this resolved string, since that's what the fs:allow-app-*-
// recursive capabilities are scoped to.
export async function getThemesFolderLocation(): Promise<string> {
  return join(await appConfigDir(), THEMES_DIR);
}

// Seeds themes/ with one file per built-in theme (dark.json, dracula.json,
// light.json) the first time the app looks for it, so there's always a real,
// always-present folder to drop a new theme file into — no "connect a
// folder" step, no picker. Only fills in files that are missing (e.g. the
// user deleted one, or it's the very first run); never overwrites one that's
// already there, so hand-edits are never clobbered.
async function ensureThemesFolder(): Promise<void> {
  if (!(await exists(THEMES_DIR, { baseDir: BaseDirectory.AppConfig }))) {
    await mkdir(THEMES_DIR, { baseDir: BaseDirectory.AppConfig, recursive: true });
  }
  for (const theme of BUILT_IN_THEMES) {
    const filePath = await join(THEMES_DIR, `${theme.id}.json`);
    if (!(await exists(filePath, { baseDir: BaseDirectory.AppConfig }))) {
      await writeTextFile(filePath, JSON.stringify(theme, null, 2), { baseDir: BaseDirectory.AppConfig });
    }
  }
}

// Every .json file directly inside themes/ is its own theme, one file each —
// auto-detected on every call (app start, "Actualiser"), no per-file import
// step. Anyone can add as many as they want: drop in a new .json file
// following the same shape and it shows up next scan. A file that fails to
// parse or doesn't match the ThemeFile shape is skipped individually rather
// than breaking the whole list.
export async function loadThemesFromFolder(): Promise<ThemeFile[]> {
  try {
    await ensureThemesFolder();
    const entries = await readDir(THEMES_DIR, { baseDir: BaseDirectory.AppConfig });
    const themes: ThemeFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile || !entry.name.toLowerCase().endsWith(".json")) continue;
      try {
        const filePath = await join(THEMES_DIR, entry.name);
        const parsed = JSON.parse(await readTextFile(filePath, { baseDir: BaseDirectory.AppConfig }));
        if (isValidThemeFile(parsed)) themes.push(parsed);
      } catch {
        // corrupt/invalid theme file — skip it rather than breaking the whole scan
      }
    }
    return themes.length > 0 ? themes : BUILT_IN_THEMES;
  } catch {
    return BUILT_IN_THEMES;
  }
}
