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
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile]
  );

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
        <p>Glissez-déposez un fichier .cbz ou .cbr ici</p>
        <button type="button" onClick={() => inputRef.current?.click()}>
          Choisir un fichier
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".cbz,.zip,.cbr,.rar"
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        {error && <p className="drop-zone__error">{error}</p>}

        {recentFiles.length > 0 && (
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
