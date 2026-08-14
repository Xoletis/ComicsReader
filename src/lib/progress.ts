export type ZoomMode = "fit-width" | "fit-height" | number;
export type Rotation = 0 | 90 | 180 | 270;

export interface ReaderProgress {
  pageIndex: number;
  pageCount: number;
  zoom: ZoomMode;
  doublePage: boolean;
  // Optional: absent on progress saved before rotation existed, treated as 0.
  rotation?: Rotation;
}

const PREFIX = "cbreader:progress:";

function keyForParts(name: string, size: number): string {
  return `${PREFIX}${name}:${size}`;
}

export function loadProgressByKey(name: string, size: number): ReaderProgress | null {
  try {
    const raw = localStorage.getItem(keyForParts(name, size));
    if (!raw) return null;
    return JSON.parse(raw) as ReaderProgress;
  } catch {
    return null;
  }
}

interface NamedSizedSource {
  name: string;
  size: number;
}

export function loadProgress(file: NamedSizedSource): ReaderProgress | null {
  return loadProgressByKey(file.name, file.size);
}

export function saveProgress(file: NamedSizedSource, progress: ReaderProgress): void {
  try {
    localStorage.setItem(keyForParts(file.name, file.size), JSON.stringify(progress));
  } catch {
    // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
  }
}

// Renaming a comic changes its progress key (name is part of it) — carry the
// saved progress over so a rename doesn't look like lost reading history.
export function renameProgressKey(oldName: string, newName: string, size: number): void {
  try {
    const raw = localStorage.getItem(keyForParts(oldName, size));
    if (raw === null) return;
    localStorage.removeItem(keyForParts(oldName, size));
    localStorage.setItem(keyForParts(newName, size), raw);
  } catch {
    // ignore
  }
}
