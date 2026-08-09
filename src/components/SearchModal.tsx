import { useEffect, useRef, useState } from "react";
import { ComicEntry, FolderEntry, PathEntry, searchLibrary, SearchResult } from "../lib/library";
import FolderIcon from "./FolderIcon";

interface Props {
  rootHandle: FileSystemDirectoryHandle;
  rootName: string;
  onNavigateFolder: (pathEntries: PathEntry[]) => void;
  onOpenComic: (entry: ComicEntry) => void;
  onClose: () => void;
}

const DEBOUNCE_MS = 300;

export default function SearchModal({ rootHandle, rootName, onNavigateFolder, onOpenComic, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    cancelledRef.current = true; // abandon whatever search was previously in flight
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => {
      cancelledRef.current = false;
      const isCancelled = () => cancelledRef.current;
      setLoading(true);
      searchLibrary(rootHandle, rootName, trimmed, isCancelled)
        .then((found) => {
          if (!isCancelled()) setResults(found);
        })
        .finally(() => {
          if (!isCancelled()) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query, rootHandle, rootName]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleSelect = (result: SearchResult) => {
    if (result.isDirectory) {
      const folder: FolderEntry = { name: result.name, handle: result.handle as FileSystemDirectoryHandle };
      onNavigateFolder([...result.parentPath, folder]);
    } else {
      onOpenComic({ name: result.name, handle: result.handle as FileSystemFileHandle });
    }
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--search" onClick={(e) => e.stopPropagation()}>
        <h3>Rechercher</h3>
        <input
          ref={inputRef}
          type="text"
          className="search-modal__input"
          placeholder="Nom d'un comic ou d'un dossier…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="search-modal__results">
          {query.trim() === "" ? (
            <p className="library__hint">Tapez pour rechercher dans toute la bibliothèque.</p>
          ) : loading && results.length === 0 ? (
            <p className="library__hint">Recherche…</p>
          ) : results.length === 0 ? (
            <p className="library__hint">Aucun résultat pour « {query.trim()} ».</p>
          ) : (
            results.map((result, i) => {
              const location = [...result.parentPath.map((p) => p.name), result.name].join(" / ");
              return (
                <button
                  type="button"
                  key={`${result.isDirectory ? "folder" : "comic"}:${location}:${i}`}
                  className="search-modal__result"
                  onClick={() => handleSelect(result)}
                  title={location}
                >
                  {result.isDirectory ? (
                    <FolderIcon className="search-modal__result-icon" />
                  ) : (
                    <span className="search-modal__result-icon search-modal__result-icon--comic">📕</span>
                  )}
                  <span className="search-modal__result-text">
                    <span className="search-modal__result-name">{result.name}</span>
                    <span className="search-modal__result-path">{location}</span>
                  </span>
                </button>
              );
            })
          )}
          {loading && results.length > 0 && <p className="library__hint">Recherche en cours…</p>}
        </div>

        <div className="modal__actions">
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
