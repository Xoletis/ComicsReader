export type ReadStatus = "unread" | "in-progress" | "read";

const PREFIX = "cbreader:readStatus:";

function keyForParts(name: string, size: number): string {
  return `${PREFIX}${name}:${size}`;
}

// A comic's read status is normally *derived* from its saved progress
// (finished the last page → "read"), but the user can override that in
// either direction — mark something read without opening it, or mark a
// finished comic unread again to flag it for a re-read. `null` means no
// override: fall back to the derived status.
export function loadReadOverride(name: string, size: number): boolean | null {
  try {
    const raw = localStorage.getItem(keyForParts(name, size));
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

export function saveReadOverride(name: string, size: number, value: boolean | null): void {
  try {
    const key = keyForParts(name, size);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
  }
}

export function renameReadStatusKey(oldName: string, newName: string, size: number): void {
  try {
    const raw = localStorage.getItem(keyForParts(oldName, size));
    if (raw === null) return;
    localStorage.removeItem(keyForParts(oldName, size));
    localStorage.setItem(keyForParts(newName, size), raw);
  } catch {
    // ignore
  }
}

interface ProgressLike {
  pageIndex: number;
  pageCount: number;
}

export function deriveReadStatus(override: boolean | null, progress: ProgressLike | null): ReadStatus {
  if (override === true) return "read";
  if (override === false) return "unread";
  if (!progress || progress.pageCount <= 0) return "unread";
  return progress.pageIndex >= progress.pageCount - 1 ? "read" : "in-progress";
}

export function getReadStatus(name: string, size: number, progress: ProgressLike | null): ReadStatus {
  return deriveReadStatus(loadReadOverride(name, size), progress);
}
