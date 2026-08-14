import { useCallback, useRef, useState } from "react";
import { RecentFile } from "../lib/recentFiles";

interface Props {
  onFile: (file: File) => void;
  error: string | null;
  recentFiles: RecentFile[];
  onOpenRecent: (entry: RecentFile) => void;
  onRemoveRecent: (entry: RecentFile) => void;
  onClearRecent: () => void;
}

const RECENT_FILES_VISIBLE_KEY = "cbreader:recentFilesVisible";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unitIndex]}`;
}

export default function FileDropZone({ onFile, error, recentFiles, onOpenRecent, onRemoveRecent, onClearRecent }: Props) {
  const [dragging, setDragging] = useState(false);
  // Hidden by default — the recent-files list otherwise takes up permanent
  // space on the home screen for something most sessions never touch.
  const [recentVisible, setRecentVisible] = useState(() => localStorage.getItem(RECENT_FILES_VISIBLE_KEY) === "1");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  const toggleRecentVisible = useCallback(() => {
    setRecentVisible((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RECENT_FILES_VISIBLE_KEY, next ? "1" : "0");
      } catch {
        // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
      }
      return next;
    });
  }, []);

  return (
    <div
      className={`drop-zone ${dragging ? "drop-zone--active" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="drop-zone__content">
        <h1>
          CBReader <span className="drop-zone__version">v{import.meta.env.VITE_APP_VERSION}</span>
        </h1>
        <p>Glissez-déposez un fichier .cbz, .cbr ou .pdf ici</p>
        <button type="button" onClick={() => inputRef.current?.click()}>
          Choisir un fichier
        </button>
        {recentFiles.length > 0 && (
          <button
            type="button"
            className={`recent-files__toggle${recentVisible ? " active" : ""}`}
            onClick={toggleRecentVisible}
            aria-expanded={recentVisible}
            aria-label="Fichiers récents"
            title="Fichiers récents"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 16 14" />
            </svg>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".cbz,.zip,.cbr,.rar,.pdf"
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        {error && <p className="drop-zone__error">{error}</p>}

        {recentVisible && recentFiles.length > 0 && (
          <div className="recent-files">
            <div className="recent-files__header">
              <span>Fichiers récents</span>
              <button type="button" className="recent-files__clear" onClick={onClearRecent}>
                Effacer
              </button>
            </div>
            <ul className="recent-files__list">
              {recentFiles.map((entry) => (
                <li key={`${entry.name}:${entry.size}`} className="recent-files__item">
                  <button type="button" className="recent-files__open" onClick={() => onOpenRecent(entry)} title={entry.name}>
                    <span className="recent-files__name">{entry.name}</span>
                    <span className="recent-files__size">{formatBytes(entry.size)}</span>
                  </button>
                  <button
                    type="button"
                    className="recent-files__remove"
                    onClick={() => onRemoveRecent(entry)}
                    aria-label={`Retirer ${entry.name} des fichiers récents`}
                    title="Retirer"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
