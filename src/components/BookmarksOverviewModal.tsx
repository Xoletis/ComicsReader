import { useEffect, useState } from "react";
import { BOOKMARK_COLOR_HEX, BookmarkGroup, loadAllBookmarkGroups, loadBookmarks, saveBookmarks } from "../lib/bookmarks";

interface Props {
  onOpenBookmark: (name: string, size: number, pageIndex: number) => void;
  onClose: () => void;
}

// A library-wide view across every comic that has ever had a bookmark saved
// (see lib/bookmarks.ts's loadAllBookmarkGroups) — the reader's own bookmark
// panel only ever shows the comic that's currently open, this is for "where
// was that panel I bookmarked, again?" when you don't remember which comic.
export default function BookmarksOverviewModal({ onOpenBookmark, onClose }: Props) {
  const [groups, setGroups] = useState<BookmarkGroup[]>(() => loadAllBookmarkGroups());

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const removeBookmark = (name: string, size: number, pageIndex: number) => {
    const remaining = loadBookmarks({ name, size }).filter((b) => b.pageIndex !== pageIndex);
    saveBookmarks({ name, size }, remaining);
    setGroups(loadAllBookmarkGroups());
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--bookmarks-overview" onClick={(e) => e.stopPropagation()}>
        <h3>Tous les marque-pages</h3>
        {groups.length === 0 ? (
          <p className="appearance-tab__hint">
            Aucun marque-page pour l'instant. Ouvrez un comic et utilisez l'icône marque-page du lecteur pour en ajouter un.
          </p>
        ) : (
          <div className="bookmarks-overview">
            {groups.map((g) => (
              <div key={`${g.name}:${g.size}`} className="bookmarks-overview__group">
                <div className="bookmarks-overview__comic" title={g.name}>
                  {g.name}
                </div>
                {g.bookmarks.map((b) => (
                  <div key={b.pageIndex} className="bookmarks-overview__item">
                    <button type="button" className="bookmarks-overview__open" onClick={() => onOpenBookmark(g.name, g.size, b.pageIndex)}>
                      <span className="bookmarks-overview__dot" style={{ background: BOOKMARK_COLOR_HEX[b.color] }} />
                      <span className="bookmarks-overview__label">{b.label}</span>
                      <span className="bookmarks-overview__page">p. {b.pageIndex + 1}</span>
                    </button>
                    <button
                      type="button"
                      className="bookmarks-overview__remove"
                      onClick={() => removeBookmark(g.name, g.size, b.pageIndex)}
                      aria-label={`Retirer le marque-page « ${b.label} »`}
                      title="Retirer"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="modal__actions">
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
