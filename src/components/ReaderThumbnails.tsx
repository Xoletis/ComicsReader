import { useCallback, useEffect, useReducer, useRef } from "react";
import { OpenedArchive } from "../lib/archive";
import { Bookmark, BOOKMARK_COLOR_HEX } from "../lib/bookmarks";

interface Props {
  archive: OpenedArchive;
  currentIndex: number;
  bookmarks: Bookmark[];
  onSelect: (index: number) => void;
  onClose: () => void;
}

export default function ReaderThumbnails({ archive, currentIndex, bookmarks, onSelect, onClose }: Props) {
  const bookmarkByPage = new Map(bookmarks.map((b) => [b.pageIndex, b]));
  const [, bumpVersion] = useReducer((n: number) => n + 1, 0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pendingRef = useRef<Set<number>>(new Set());
  const failedRef = useRef<Set<number>>(new Set());
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  // Thumbnails are decoded lazily as each row scrolls into view, never all at
  // once — the same "extract on demand" principle as the main reader, since
  // eagerly decoding every page of a large archive just to build a sidebar
  // would defeat the point of the memory-bounded page loading elsewhere.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (Number.isNaN(index) || archive.peekPage(index) || pendingRef.current.has(index)) continue;
          pendingRef.current.add(index);
          archive
            .getPage(index)
            .then(() => {
              failedRef.current.delete(index);
              bumpVersion();
            })
            .catch(() => {
              failedRef.current.add(index);
              bumpVersion();
            })
            .finally(() => pendingRef.current.delete(index));
        }
      },
      { root, rootMargin: "200px 0px" }
    );
    observerRef.current = observer;
    return () => observer.disconnect();
  }, [archive]);

  const rowRef = useCallback(
    (el: HTMLButtonElement | null, index: number) => {
      if (index === currentIndex) activeRowRef.current = el;
      if (!el || !observerRef.current) return;
      el.dataset.index = String(index);
      observerRef.current.observe(el);
    },
    [currentIndex]
  );

  // Scrolls the current page into view once, when the panel first opens.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "center" });
  }, []);

  const pages = Array.from({ length: archive.pageCount }, (_, index) => index);

  return (
    <aside className="reader-thumbnails">
      <div className="reader-thumbnails__header">
        <h3>Vignettes</h3>
        <button type="button" className="reader-thumbnails__close" onClick={onClose} title="Masquer les vignettes">
          ✕
        </button>
      </div>
      <div className="reader-thumbnails__body" ref={bodyRef}>
        {pages.map((index) => {
          const page = archive.peekPage(index);
          const isActive = index === currentIndex;
          const bookmark = bookmarkByPage.get(index);
          return (
            <button
              key={index}
              type="button"
              ref={(el) => rowRef(el, index)}
              className={`reader-thumbnails__row${isActive ? " reader-thumbnails__row--active" : ""}`}
              onClick={() => onSelect(index)}
            >
              <span className="reader-thumbnails__thumb">
                {page ? (
                  <img src={page.url} alt="" className="reader-thumbnails__image" draggable={false} />
                ) : failedRef.current.has(index) ? (
                  <span className="reader-thumbnails__error">!</span>
                ) : (
                  <span className="reader-thumbnails__spinner" />
                )}
                {bookmark && (
                  <span
                    className="reader-thumbnails__bookmark-badge"
                    style={{ background: BOOKMARK_COLOR_HEX[bookmark.color] }}
                    title={bookmark.label}
                  />
                )}
              </span>
              <span className="reader-thumbnails__number">{index + 1}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
