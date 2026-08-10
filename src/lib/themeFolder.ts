import { withStore } from "./db";
import { PermissionState } from "./library";
import { isValidThemeFile, ThemeFile } from "./themeFile";

const HANDLE_KEY = "themesDirectoryHandle";

export async function saveThemesDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await withStore("readwrite", (store) => store.put(handle, HANDLE_KEY));
}

export async function loadThemesDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await withStore<FileSystemDirectoryHandle | undefined>("readonly", (store) => store.get(HANDLE_KEY));
  return handle ?? null;
}

export async function clearThemesDirectoryHandle(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(HANDLE_KEY));
}

export async function queryThemesFolderPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return handle.queryPermission({ mode: "read" });
}

export async function requestThemesFolderPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return handle.requestPermission({ mode: "read" });
}

export async function pickThemesFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ id: "cbreader-themes", mode: "read" });
  await saveThemesDirectoryHandle(handle);
  return handle;
}

// Auto-detection: every .json file directly inside the connected folder is
// read and validated on each scan (folder open, "Actualiser", app start) —
// drop a new theme file in and it just shows up next time the list is
// refreshed, no import step required. A file that fails to parse or doesn't
// match the ThemeColors shape is skipped rather than breaking the whole scan,
// since one malformed file shouldn't take down every other custom theme.
export async function scanThemesFolder(handle: FileSystemDirectoryHandle): Promise<ThemeFile[]> {
  const themes: ThemeFile[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file" || !entry.name.toLowerCase().endsWith(".json")) continue;
    try {
      const file = await entry.getFile();
      const parsed = JSON.parse(await file.text());
      if (isValidThemeFile(parsed)) themes.push(parsed);
    } catch {
      // corrupt/invalid theme file — skip it rather than breaking the whole scan
    }
  }
  return themes;
}
