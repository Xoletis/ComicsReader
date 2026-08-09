import { useEffect, useState } from "react";
import { FolderEntry, listEntries, PathEntry } from "../lib/library";

export type { PathEntry };

export interface MoveItem {
  name: string;
  isDirectory: boolean;
}

interface Props {
  items: MoveItem[];
  initialPath: PathEntry[];
  sourceParent: FileSystemDirectoryHandle;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (destination: FileSystemDirectoryHandle) => void;
}

export default function MoveFolderModal({ items, initialPath, sourceParent, busy, error, onCancel, onConfirm }: Props) {
  const [path, setPath] = useState<PathEntry[]>(initialPath);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const currentHandle = path[path.length - 1].handle;
  const isAtSource = currentHandle === sourceParent;
  const movingFolderNames = new Set(items.filter((it) => it.isDirectory).map((it) => it.name));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listEntries(currentHandle)
      .then(({ folders }) => {
        if (!cancelled) setFolders(folders);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentHandle]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const visibleFolders = folders.filter((f) => !(isAtSource && movingFolderNames.has(f.name)));
  const title = items.length === 1 ? `Déplacer « ${items[0].name} »` : `Déplacer ${items.length} éléments`;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--move" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>

        <div className="modal__breadcrumb">
          {path.map((entry, i) => (
            <span key={i}>
              {i > 0 && <span className="modal__breadcrumb-sep">/</span>}
              <button type="button" disabled={i === path.length - 1 || busy} onClick={() => setPath(path.slice(0, i + 1))}>
                {entry.name}
              </button>
            </span>
          ))}
        </div>

        <div className="modal__folder-list">
          {loading ? (
            <p className="library__hint">Chargement…</p>
          ) : visibleFolders.length === 0 ? (
            <p className="library__hint">Aucun sous-dossier ici.</p>
          ) : (
            visibleFolders.map((folder) => (
              <button
                type="button"
                key={folder.name}
                className="modal__folder-row"
                disabled={busy}
                onClick={() => setPath([...path, folder])}
              >
                📁 {folder.name}
              </button>
            ))
          )}
        </div>

        {error && <p className="modal__error">{error}</p>}

        <div className="modal__actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="button" className="active" disabled={busy || isAtSource} onClick={() => onConfirm(currentHandle)}>
            {isAtSource ? "Déjà ici" : busy ? "Déplacement…" : "Déplacer ici"}
          </button>
        </div>
      </div>
    </div>
  );
}
