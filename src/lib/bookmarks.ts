export type BookmarkColor = "yellow" | "red" | "blue" | "green" | "purple";

export const BOOKMARK_COLORS: BookmarkColor[] = ["yellow", "red", "blue", "green", "purple"];
const DEFAULT_COLOR: BookmarkColor = "yellow";

// Fixed, theme-independent swatches (sticky-note style) — bookmark colors
// are a user-chosen category, not part of the app's own light/dark theming,
// so they stay the same regardless of which theme is active.
export const BOOKMARK_COLOR_HEX: Record<BookmarkColor, string> = {
  yellow: "#eab308",
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  purple: "#a855f7",
};

export interface Bookmark {
  pageIndex: number;
  label: string;
  color: BookmarkColor;
  createdAt: number;
}

const PREFIX = "cbreader:bookmarks:";

function keyForParts(name: string, size: number): string {
  return `${PREFIX}${name}:${size}`;
}

interface NamedSizedSource {
  name: string;
  size: number;
}

// Accepts both the current {pageIndex,label,color,createdAt} shape and the
// original v1.2 shape (a bare page-index number) so bookmarks saved before
// this richer model existed still load instead of silently vanishing.
function normalizeEntry(raw: unknown): Bookmark | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { pageIndex: raw, label: `Page ${raw + 1}`, color: DEFAULT_COLOR, createdAt: Date.now() } : null;
  }
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.pageIndex !== "number") return null;
    return {
      pageIndex: r.pageIndex,
      label: typeof r.label === "string" && r.label.trim() ? r.label : `Page ${r.pageIndex + 1}`,
      color: BOOKMARK_COLORS.includes(r.color as BookmarkColor) ? (r.color as BookmarkColor) : DEFAULT_COLOR,
      createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    };
  }
  return null;
}

export function defaultBookmark(pageIndex: number): Bookmark {
  return { pageIndex, label: `Page ${pageIndex + 1}`, color: DEFAULT_COLOR, createdAt: Date.now() };
}

export function loadBookmarks(file: NamedSizedSource): Bookmark[] {
  try {
    const raw = localStorage.getItem(keyForParts(file.name, file.size));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEntry).filter((b): b is Bookmark => b !== null);
  } catch {
    return [];
  }
}

export function saveBookmarks(file: NamedSizedSource, bookmarks: Bookmark[]): void {
  try {
    if (bookmarks.length === 0) {
      localStorage.removeItem(keyForParts(file.name, file.size));
    } else {
      localStorage.setItem(keyForParts(file.name, file.size), JSON.stringify(bookmarks));
    }
  } catch {
    // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
  }
}

// Renaming a comic changes its bookmarks key (name is part of it) — carry
// them over so a rename doesn't look like lost bookmarks, mirroring
// lib/progress.ts's renameProgressKey.
export function renameBookmarksKey(oldName: string, newName: string, size: number): void {
  try {
    const raw = localStorage.getItem(keyForParts(oldName, size));
    if (raw === null) return;
    localStorage.removeItem(keyForParts(oldName, size));
    localStorage.setItem(keyForParts(newName, size), raw);
  } catch {
    // ignore
  }
}

export interface BookmarkGroup {
  name: string;
  size: number;
  bookmarks: Bookmark[];
}

// Scans every bookmarks entry across every comic ever bookmarked (not just
// the one currently open) — powers the cross-comic "Tous les marque-pages"
// overview. File names can't contain ":" on any platform this app targets,
// so splitting the storage key on its *last* colon reliably separates the
// name from the trailing size.
export function loadAllBookmarkGroups(): BookmarkGroup[] {
  const groups: BookmarkGroup[] = [];
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(PREFIX)) continue;
    const rest = key.slice(PREFIX.length);
    const lastColon = rest.lastIndexOf(":");
    if (lastColon === -1) continue;
    const name = rest.slice(0, lastColon);
    const size = Number(rest.slice(lastColon + 1));
    if (!Number.isFinite(size)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      const bookmarks = parsed.map(normalizeEntry).filter((b): b is Bookmark => b !== null);
      if (bookmarks.length > 0) groups.push({ name, size, bookmarks: bookmarks.sort((a, b) => a.pageIndex - b.pageIndex) });
    } catch {
      continue;
    }
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name));
}
