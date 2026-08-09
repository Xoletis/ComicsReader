import { Fragment, useEffect, useState } from "react";
import { openArchive } from "../lib/archive";
import { listEntries } from "../lib/library";

interface Props {
  name: string;
  isDirectory: boolean;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  pathNames: string[];
  onClose: () => void;
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

export default function InfoModal({ name, isDirectory, handle, pathNames, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState<number | null>(null);
  const [lastModified, setLastModified] = useState<number | null>(null);
  const [metadata, setMetadata] = useState<{ label: string; value: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (isDirectory) {
          const { folders, comics } = await listEntries(handle as FileSystemDirectoryHandle);
          if (cancelled) return;
          setMetadata([
            { label: "Sous-dossiers", value: String(folders.length) },
            { label: "Comics", value: String(comics.length) },
          ]);
        } else {
          const file = await (handle as FileSystemFileHandle).getFile();
          if (cancelled) return;
          setSize(file.size);
          setLastModified(file.lastModified);
          try {
            const archive = await openArchive(file);
            if (!cancelled) {
              setMetadata([
                { label: "Format", value: archive.format.toUpperCase() },
                { label: "Pages", value: String(archive.pageCount) },
              ]);
            }
            archive.dispose();
          } catch {
            if (!cancelled) setMetadata([{ label: "Format", value: "Illisible" }]);
          }
        }
      } catch {
        if (!cancelled) setError("Impossible de lire les informations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, isDirectory]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const location = pathNames.join(" / ");

  const handleCopyLocation = async () => {
    try {
      await navigator.clipboard.writeText(location);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // presse-papiers indisponible - on ignore silencieusement
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--info" onClick={(e) => e.stopPropagation()}>
        <h3>Informations</h3>
        <dl className="info-list">
          <dt>Nom</dt>
          <dd>{name}</dd>

          <dt>Emplacement</dt>
          <dd className="info-list__location">
            <span className="info-list__path" title={location}>
              {location}
            </span>
            <button type="button" onClick={handleCopyLocation}>
              {copied ? "Copié !" : "Copier"}
            </button>
          </dd>

          {!isDirectory && (
            <>
              <dt>Poids</dt>
              <dd>{loading ? "…" : size !== null ? formatBytes(size) : "—"}</dd>
              <dt>Modifié le</dt>
              <dd>{loading || !lastModified ? "—" : new Date(lastModified).toLocaleString("fr-FR")}</dd>
            </>
          )}

          {loading ? (
            <>
              <dt>{isDirectory ? "Contenu" : "Métadonnées"}</dt>
              <dd>Lecture…</dd>
            </>
          ) : (
            metadata.map((m) => (
              <Fragment key={m.label}>
                <dt>{m.label}</dt>
                <dd>{m.value}</dd>
              </Fragment>
            ))
          )}
        </dl>

        {error && <p className="modal__error">{error}</p>}

        <div className="modal__actions">
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
