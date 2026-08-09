import { useCallback, useEffect, useRef, useState } from "react";
import Home from "./components/Home";
import Reader from "./components/Reader";
import UpdateBanner from "./components/UpdateBanner";
import { ArchiveSource, OpenedArchive, openArchive, UnsupportedFormatError } from "./lib/archive";
import { watchDesktopFileOpen } from "./lib/desktopOpen";
import { loadProgress, ReaderProgress, saveProgress } from "./lib/progress";

export default function App() {
  const [file, setFile] = useState<ArchiveSource | null>(null);
  const [archive, setArchive] = useState<OpenedArchive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libraryRefreshSignal, setLibraryRefreshSignal] = useState(0);
  const [openingName, setOpeningName] = useState<string | null>(null);
  const archiveRef = useRef<OpenedArchive | null>(null);

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

  // Handles comics opened via the OS (double-clicking a .cbz/.cbr with
  // CBReader set as the default app) — a no-op outside the desktop build.
  // Wired once via a ref so it doesn't resubscribe every time handleFile's
  // identity changes.
  useEffect(() => {
    return watchDesktopFileOpen((file) => handleFileRef.current(file));
  }, []);

  return (
    <>
      <div className={`app-layer ${archive ? "app-layer--hidden" : ""}`}>
        <Home onFile={handleFile} error={error} libraryRefreshSignal={libraryRefreshSignal} />
      </div>
      {archive && file && (
        <Reader
          fileName={file.name}
          archive={archive}
          initialProgress={loadProgress(file)}
          onProgress={handleProgress}
          onClose={handleClose}
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
      <UpdateBanner />
    </>
  );
}
