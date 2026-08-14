import { useCallback, useEffect, useRef, useState } from "react";
import BookmarksOverviewModal from "./components/BookmarksOverviewModal";
import Home from "./components/Home";
import Reader from "./components/Reader";
import SettingsModal from "./components/SettingsModal";
import UpdateBanner from "./components/UpdateBanner";
import { ArchiveSource, OpenedArchive, openArchive, UnsupportedFormatError } from "./lib/archive";
import { Bookmark, loadBookmarks, saveBookmarks } from "./lib/bookmarks";
import { ComfortFilterId, loadComfortFilter, saveComfortFilter } from "./lib/comfortFilter";
import { pathToSource, watchDesktopFileOpen } from "./lib/desktopOpen";
import { loadProgress, ReaderProgress, saveProgress } from "./lib/progress";
import { addRecentFile, clearRecentFiles, loadRecentFiles, RecentFile, removeRecentFile } from "./lib/recentFiles";
import { loadShortcutOverrides, ShortcutOverrides } from "./lib/shortcuts";
import { loadPerformancePreset, PerformancePreset } from "./lib/performance";

export default function App() {
  const [file, setFile] = useState<ArchiveSource | null>(null);
  const [archive, setArchive] = useState<OpenedArchive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libraryRefreshSignal, setLibraryRefreshSignal] = useState(0);
  const [openingName, setOpeningName] = useState<string | null>(null);
  // Settings live here (not in Reader) so the theme/shortcuts editor is
  // reachable from the library screen too, not just from inside an open comic.
  const [showSettings, setShowSettings] = useState(false);
  const [shortcutOverrides, setShortcutOverrides] = useState<ShortcutOverrides>(() => loadShortcutOverrides());
  const [performancePreset, setPerformancePreset] = useState<PerformancePreset>(() => loadPerformancePreset());
  const [comfortFilter, setComfortFilter] = useState<ComfortFilterId>(() => loadComfortFilter());
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => loadRecentFiles());
  const [showBookmarksOverview, setShowBookmarksOverview] = useState(false);
  const archiveRef = useRef<OpenedArchive | null>(null);
  // Only entries opened via a real filesystem path (see lib/recentFiles.ts)
  // survive a restart; everything else (drag-and-drop, the plain file
  // picker, the Library) is only re-openable for the rest of this session,
  // via whatever ArchiveSource instance is still cached here.
  const sessionSourceCache = useRef<Map<string, ArchiveSource>>(new Map());
  // Set by openBookmark just before handleFile opens a comic from the
  // cross-comic bookmarks overview — consumed once by the initialProgress
  // computed for that Reader mount, so it lands exactly on the bookmarked
  // page instead of wherever normal reading progress last left off.
  const pendingJumpRef = useRef<number | null>(null);

  const handleComfortFilterChange = useCallback((id: ComfortFilterId) => {
    saveComfortFilter(id);
    setComfortFilter(id);
  }, []);

  useEffect(() => {
    archiveRef.current = archive;
  }, [archive]);

  useEffect(() => {
    return () => {
      archiveRef.current?.dispose();
    };
  }, []);

  const handleFile = useCallback(async (selected: ArchiveSource) => {
    if (openingName) return; // already opening one file, ignore extra clicks
    setError(null);
    setOpeningName(selected.name);
    try {
      const opened = await openArchive(selected);
      archiveRef.current?.dispose();
      setFile(selected);
      setArchive(opened);
      sessionSourceCache.current.set(`${selected.name}:${selected.size}`, selected);
      setRecentFiles(addRecentFile({ name: selected.name, size: selected.size, openedAt: Date.now(), path: selected.path }));
    } catch (err) {
      if (err instanceof UnsupportedFormatError) {
        setError(err.message);
      } else {
        console.error(err);
        setError("Impossible d'ouvrir ce fichier. Vérifiez qu'il s'agit bien d'une archive CBZ ou CBR valide.");
      }
    } finally {
      setOpeningName(null);
    }
  }, [openingName]);

  const handleProgress = useCallback(
    (progress: ReaderProgress) => {
      if (file) saveProgress(file, progress);
    },
    [file]
  );

  const handleBookmarksChange = useCallback(
    (bookmarks: Bookmark[]) => {
      if (file) saveBookmarks(file, bookmarks);
    },
    [file]
  );

  const handleClose = useCallback(() => {
    archiveRef.current?.dispose();
    setArchive(null);
    setFile(null);
    setLibraryRefreshSignal((n) => n + 1);
  }, []);

  const handleFileRef = useRef(handleFile);
  useEffect(() => {
    handleFileRef.current = handleFile;
  }, [handleFile]);

  // Shared by openRecent and openBookmark: same-session cache first (works
  // regardless of how the comic was originally opened), then a stored
  // filesystem path if one exists (desktop file-association opens only).
  const resolveSource = useCallback(
    async (name: string, size: number): Promise<ArchiveSource | null> => {
      const cached = sessionSourceCache.current.get(`${name}:${size}`);
      if (cached) return cached;
      const path = recentFiles.find((f) => f.name === name && f.size === size)?.path;
      if (path) {
        try {
          return await pathToSource(path);
        } catch {
          // le fichier a pu être déplacé ou supprimé depuis - null ci-dessous
        }
      }
      return null;
    },
    [recentFiles]
  );

  const openRecent = useCallback(
    async (entry: RecentFile) => {
      const source = await resolveSource(entry.name, entry.size);
      if (source) {
        handleFile(source);
      } else {
        setError(`« ${entry.name} » n'est plus disponible. Ouvrez-le à nouveau depuis son emplacement.`);
      }
    },
    [resolveSource, handleFile]
  );

  const removeRecent = useCallback((entry: RecentFile) => {
    setRecentFiles(removeRecentFile(entry.name, entry.size));
  }, []);

  const clearRecent = useCallback(() => {
    setRecentFiles(clearRecentFiles());
  }, []);

  const openBookmark = useCallback(
    async (name: string, size: number, pageIndex: number) => {
      const source = await resolveSource(name, size);
      if (source) {
        pendingJumpRef.current = pageIndex;
        setShowBookmarksOverview(false);
        handleFile(source);
      } else {
        setError(`« ${name} » n'est plus disponible. Ouvrez-le à nouveau depuis son emplacement.`);
      }
    },
    [resolveSource, handleFile]
  );

  // Handles comics opened via the OS (double-clicking a .cbz/.cbr with
  // CBReader set as the default app) — a no-op outside the desktop build.
  // Wired once via a ref so it doesn't resubscribe every time handleFile's
  // identity changes.
  useEffect(() => {
    return watchDesktopFileOpen((file) => handleFileRef.current(file));
  }, []);

  // Reader only reads its initialProgress prop once, at mount (its own
  // pageIndex state is seeded from it via a lazy useState initializer) — so
  // consuming pendingJumpRef here, during render, is safe: it's cleared in
  // the exact render that mounts the new Reader instance for this file, and
  // every later re-render (jump already null) just falls through to the
  // normal saved progress.
  const readerInitialProgress = (() => {
    if (!file) return null;
    const jump = pendingJumpRef.current;
    if (jump === null) return loadProgress(file);
    pendingJumpRef.current = null;
    const base = loadProgress(file);
    return {
      pageIndex: jump,
      pageCount: base?.pageCount ?? archive?.pageCount ?? 0,
      zoom: base?.zoom ?? "fit-width",
      doublePage: base?.doublePage ?? false,
      rotation: base?.rotation ?? 0,
    } as ReaderProgress;
  })();

  return (
    <>
      <div className={`app-layer ${archive ? "app-layer--hidden" : ""}`}>
        <Home
          onFile={handleFile}
          error={error}
          libraryRefreshSignal={libraryRefreshSignal}
          onOpenSettings={() => setShowSettings(true)}
          onOpenBookmarksOverview={() => setShowBookmarksOverview(true)}
          shortcutOverrides={shortcutOverrides}
          active={!archive}
          recentFiles={recentFiles}
          onOpenRecent={openRecent}
          onRemoveRecent={removeRecent}
          onClearRecent={clearRecent}
        />
      </div>
      {archive && file && (
        <Reader
          key={`${file.name}:${file.size}`}
          archive={archive}
          initialProgress={readerInitialProgress}
          onProgress={handleProgress}
          onClose={handleClose}
          onOpenFile={handleFile}
          shortcutOverrides={shortcutOverrides}
          onOpenSettings={() => setShowSettings(true)}
          settingsOpen={showSettings}
          performancePreset={performancePreset}
          comfortFilter={comfortFilter}
          initialBookmarks={loadBookmarks(file)}
          onBookmarksChange={handleBookmarksChange}
        />
      )}
      {openingName && (
        <div className="opening-overlay">
          <span className="opening-overlay__spinner" />
          <p className="opening-overlay__text" title={openingName}>
            Ouverture de « {openingName} »…
          </p>
        </div>
      )}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onShortcutsChange={setShortcutOverrides}
          performancePreset={performancePreset}
          onPerformanceChange={setPerformancePreset}
          comfortFilter={comfortFilter}
          onComfortFilterChange={handleComfortFilterChange}
        />
      )}
      {showBookmarksOverview && (
        <BookmarksOverviewModal onOpenBookmark={openBookmark} onClose={() => setShowBookmarksOverview(false)} />
      )}
      <UpdateBanner />
    </>
  );
}
