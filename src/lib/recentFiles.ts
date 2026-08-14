export interface RecentFile {
  name: string;
  size: number;
  openedAt: number;
  // Only set for desktop file-association opens (see lib/desktopOpen.ts) —
  // a comic opened via drag-and-drop, the plain file picker, or the Library
  // has no stable path to reopen from later, and is only reopenable within
  // the same session via App.tsx's in-memory source cache.
  path?: string;
}

const STORAGE_KEY = "cbreader:recentFiles";
const MAX_RECENT = 15;

export function loadRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(list: RecentFile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
  }
}

export function addRecentFile(entry: RecentFile): RecentFile[] {
  const existing = loadRecentFiles().filter((f) => !(f.name === entry.name && f.size === entry.size));
  const next = [entry, ...existing].slice(0, MAX_RECENT);
  save(next);
  return next;
}

export function removeRecentFile(name: string, size: number): RecentFile[] {
  const next = loadRecentFiles().filter((f) => !(f.name === name && f.size === size));
  save(next);
  return next;
}

export function clearRecentFiles(): RecentFile[] {
  save([]);
  return [];
}
