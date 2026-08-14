export type SortBy = "name" | "date" | "size" | "readStatus";
export type SortDir = "asc" | "desc";
export type StatusFilter = "all" | "unread" | "in-progress" | "read";

export interface LibraryViewPrefs {
  sortBy: SortBy;
  sortDir: SortDir;
  filter: StatusFilter;
}

const KEY = "cbreader:libraryView";

const DEFAULT_PREFS: LibraryViewPrefs = { sortBy: "name", sortDir: "asc", filter: "all" };

export function loadLibraryViewPrefs(): LibraryViewPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveLibraryViewPrefs(prefs: LibraryViewPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
  }
}
