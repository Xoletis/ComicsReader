import { useEffect, useReducer, useState } from "react";
import { OpenedArchive } from "../lib/archive";
import { Bookmark, BOOKMARK_COLOR_HEX, BOOKMARK_COLORS, BookmarkColor } from "../lib/bookmarks";

interface Props {
  archive: OpenedArchive;
  bookmarks: Bookmark[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onRename: (pageIndex: number, label: string) => void;
  onColor: (pageIndex: number, color: BookmarkColor) => void;
  onRemove: (pageIndex: number) => void;
  onClose: () => void;
}

// The reader's advanced bookmark browser: a label (renamable inline), a
// color category, and a thumbnail per entry, sorted by page order — a step
// up from ReaderThumbnails' plain grid since a bookmark is a note the reader
// left themselves, not just a page reference.
export default function BookmarkPanel({ archive, bookmarks, currentIndex, onSelect, onRename, onColor, onRemove, onClose }: Props) {
  const [, bumpVersion] = useReducer((n: number) => n + 1, 0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [colorPickerIndex, setColorPickerIndex] = useState<number | null>(null);

  const sorted = [...bookmarks].sort((a, b) => a.pageIndex - b.pageIndex);

  // Bookmarked pages are usually scattered outside the main reader's
  // prefetch radius, so this panel eagerly loads its own thumbnails instead
  // of waiting for the main reader to happen to pass near them.
  useEffect(() => {
    let cancelled = false;
    for (const b of sorted) {
      if (archive.peekPage(b.pageIndex)) continue;
      archive
        .getPage(b.pageIndex)
        .then(() => {
          if (!cancelled) bumpVersion();
        })
        .catch(() => {
          // page illisible - la vignette reste vide, pas bloquant ici
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archive, bookmarks]);

  const startEdit = (b: Bookmark) => {
    setEditingIndex(b.pageIndex);
    setEditValue(b.label);
    setColorPickerIndex(null);
  };

  const commitEdit = () => {
    if (editingIndex !== null) {
      const trimmed = editValue.trim();
      onRename(editingIndex, trimmed || `Page ${editingIndex + 1}`);
    }
    setEditingIndex(null);
  };

  return (
    <aside className="bookmark-panel">
      <div className="reader-thumbnails__header">
        <h3>Marque-pages</h3>
        <button type="button" className="reader-thumbnails__close" onClick={onClose} title="Masquer les marque-pages">
          ✕
        </button>
      </div>
      <div className="bookmark-panel__body">
        {sorted.length === 0 && (
          <p className="bookmark-panel__empty">Aucun marque-page. Utilisez l'icône marque-page de la barre d'outils pour en ajouter un.</p>
        )}
        {sorted.map((b) => {
          const page = archive.peekPage(b.pageIndex);
          const isActive = b.pageIndex === currentIndex;
          return (
            <div key={b.pageIndex} className={`bookmark-panel__row${isActive ? " bookmark-panel__row--active" : ""}`}>
              <button
                type="button"
                className="bookmark-panel__thumb"
                onClick={() => onSelect(b.pageIndex)}
                title={`Aller à la page ${b.pageIndex + 1}`}
              >
                {page ? <img src={page.url} alt="" draggable={false} /> : <span className="reader-thumbnails__spinner" />}
              </button>
              <div className="bookmark-panel__info">
                {editingIndex === b.pageIndex ? (
                  <input
                    className="bookmark-panel__label-input"
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditingIndex(null);
                    }}
                  />
                ) : (
                  <button type="button" className="bookmark-panel__label" onClick={() => startEdit(b)} title="Renommer">
                    {b.label}
                  </button>
                )}
                <span className="bookmark-panel__page">Page {b.pageIndex + 1}</span>
              </div>
              <div className="bookmark-panel__actions">
                <div className="bookmark-panel__color-wrap">
                  <button
                    type="button"
                    className="bookmark-panel__color-dot"
                    style={{ background: BOOKMARK_COLOR_HEX[b.color] }}
                    onClick={() => setColorPickerIndex(colorPickerIndex === b.pageIndex ? null : b.pageIndex)}
                    title="Changer la couleur"
                    aria-label="Changer la couleur"
                  />
                  {colorPickerIndex === b.pageIndex && (
                    <div className="bookmark-panel__color-picker">
                      {BOOKMARK_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className="bookmark-panel__color-option"
                          style={{ background: BOOKMARK_COLOR_HEX[c] }}
                          onClick={() => {
                            onColor(b.pageIndex, c);
                            setColorPickerIndex(null);
                          }}
                          aria-label={c}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="bookmark-panel__remove"
                  onClick={() => onRemove(b.pageIndex)}
                  aria-label={`Retirer le marque-page page ${b.pageIndex + 1}`}
                  title="Retirer"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
