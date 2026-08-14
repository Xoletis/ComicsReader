import { deriveReadStatus, ReadStatus } from "./readStatus";

const TIME_KEY = "cbreader:stats:totalTimeMs";
const PAGES_KEY = "cbreader:stats:totalPagesRead";
const PROGRESS_PREFIX = "cbreader:progress:";
const READSTATUS_PREFIX = "cbreader:readStatus:";

function loadNumber(key: string): number {
  try {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

function saveNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
  }
}

export function loadTotalTimeMs(): number {
  return loadNumber(TIME_KEY);
}

export function addReadingTime(ms: number): void {
  if (ms <= 0) return;
  saveNumber(TIME_KEY, loadTotalTimeMs() + ms);
}

export function loadTotalPagesRead(): number {
  return loadNumber(PAGES_KEY);
}

export function incrementPagesRead(): void {
  saveNumber(PAGES_KEY, loadTotalPagesRead() + 1);
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

export interface LibraryReadCounts {
  read: number;
  inProgress: number;
}

// Scans every progress/read-status entry ever saved, for any comic in any
// folder — the same "walk every matching localStorage key" approach as
// lib/bookmarks.ts's loadAllBookmarkGroups — to count how many comics are
// finished vs. still in progress across the whole library, not just the
// folder currently open.
export function scanLibraryReadCounts(): LibraryReadCounts {
  const statusByComic = new Map<string, ReadStatus>();

  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(PROGRESS_PREFIX)) continue;
    const comicKey = key.slice(PROGRESS_PREFIX.length);
    try {
      const progress = JSON.parse(localStorage.getItem(key) ?? "null");
      if (!progress || typeof progress.pageIndex !== "number" || typeof progress.pageCount !== "number") continue;
      const override = loadOverrideForComicKey(comicKey);
      statusByComic.set(comicKey, deriveReadStatus(override, progress));
    } catch {
      continue;
    }
  }

  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(READSTATUS_PREFIX)) continue;
    const comicKey = key.slice(READSTATUS_PREFIX.length);
    if (statusByComic.has(comicKey)) continue; // already resolved from progress above
    const raw = localStorage.getItem(key);
    statusByComic.set(comicKey, raw === "1" ? "read" : "unread");
  }

  let read = 0;
  let inProgress = 0;
  for (const status of statusByComic.values()) {
    if (status === "read") read++;
    else if (status === "in-progress") inProgress++;
  }
  return { read, inProgress };
}

function loadOverrideForComicKey(comicKey: string): boolean | null {
  try {
    const raw = localStorage.getItem(`${READSTATUS_PREFIX}${comicKey}`);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}
