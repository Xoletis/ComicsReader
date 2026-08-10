import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { OpenedArchive } from "../lib/archive";
import { ReaderProgress, ZoomMode } from "../lib/progress";
import { buildComboToActionMap, comboFromEvent, loadShortcutOverrides, ShortcutOverrides } from "../lib/shortcuts";
import { buildSpreads, findSpreadIndex } from "../lib/spreads";
import ReaderThumbnails from "./ReaderThumbnails";
import SettingsModal from "./SettingsModal";
import ToolbarMenu from "./ToolbarMenu";

interface Props {
  archive: OpenedArchive;
  initialProgress: ReaderProgress | null;
  onProgress: (progress: ReaderProgress) => void;
  onClose: () => void;
  onOpenFile: (file: File) => void;
}

const ZOOM_MIN = 25;
const ZOOM_MAX = 400;
const ZOOM_STEP = 10;

// How many pages around the current one stay decoded in memory. Prefetching a
// small window keeps navigation smooth, while eviction outside a slightly wider
// window keeps memory bounded even for archives with hundreds of large pages.
const PREFETCH_RADIUS = 2;
const KEEP_RADIUS = 5;

const THUMBNAILS_VISIBLE_KEY = "cbreader:readerThumbnailsVisible";
const PAGEBAR_VISIBLE_KEY = "cbreader:readerPageBarVisible";

export default function Reader({ archive, initialProgress, onProgress, onClose, onOpenFile }: Props) {
  const [pageIndex, setPageIndex] = useState(() => Math.min(initialProgress?.pageIndex ?? 0, archive.pageCount - 1));
  const [zoom, setZoom] = useState<ZoomMode>(initialProgress?.zoom ?? "fit-width");
  const [doublePage, setDoublePage] = useState(initialProgress?.doublePage ?? false);
  const [fullscreen, setFullscreen] = useState(false);
  const [failedPages, setFailedPages] = useState<Set<number>>(new Set());
  const [pageInput, setPageInput] = useState(() => String((initialProgress?.pageIndex ?? 0) + 1));
  const [, bumpVersion] = useReducer((n: number) => n + 1, 0);
  const [isPanning, setIsPanning] = useState(false);
  const [zoomSettled, setZoomSettled] = useState(true);
  const [showThumbnails, setShowThumbnails] = useState(() => localStorage.getItem(THUMBNAILS_VISIBLE_KEY) === "1");
  // Hidden by default: the page count/input/slider live in the bottom bar
  // instead of always taking up space in the toolbar.
  const [showPageBar, setShowPageBar] = useState(() => localStorage.getItem(PAGEBAR_VISIBLE_KEY) === "1");
  const [showSettings, setShowSettings] = useState(false);
  const [shortcutOverrides, setShortcutOverrides] = useState<ShortcutOverrides>(() => loadShortcutOverrides());
  const containerRef = useRef<HTMLDivElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const openFileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastWheelRef = useRef(0);
  const pendingScrollRef = useRef<"top" | "bottom" | null>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const zoomAnchorRef = useRef<{ mouseX: number; mouseY: number; fractionX: number; fractionY: number } | null>(null);

  const spreads = useMemo(() => buildSpreads(archive.pageCount, doublePage), [archive.pageCount, doublePage]);
  const currentSpreadIdx = findSpreadIndex(spreads, pageIndex);
  const currentSpread = spreads[currentSpreadIdx] ?? [0];

  const goNext = useCallback(() => {
    const idx = findSpreadIndex(spreads, pageIndex);
    if (idx < spreads.length - 1) setPageIndex(spreads[idx + 1][0]);
  }, [spreads, pageIndex]);

  const goPrev = useCallback(() => {
    const idx = findSpreadIndex(spreads, pageIndex);
    if (idx > 0) setPageIndex(spreads[idx - 1][0]);
  }, [spreads, pageIndex]);

  const goFirst = useCallback(() => setPageIndex(0), []);
  const goLast = useCallback(() => setPageIndex(spreads[spreads.length - 1]?.[0] ?? 0), [spreads]);

  // Keeps the page-number field showing the current page whenever navigation
  // happens some other way (buttons, keyboard, clicking a nav zone...).
  useEffect(() => {
    setPageInput(String(pageIndex + 1));
  }, [pageIndex]);

  const commitPageInput = useCallback(() => {
    const parsed = parseInt(pageInput, 10);
    if (Number.isNaN(parsed)) {
      setPageInput(String(pageIndex + 1));
      return;
    }
    const clamped = Math.min(Math.max(parsed, 1), archive.pageCount);
    setPageIndex(clamped - 1);
    setPageInput(String(clamped));
  }, [pageInput, pageIndex, archive.pageCount]);

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, (typeof z === "number" ? z : 100) + ZOOM_STEP));
  }, []);
  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, (typeof z === "number" ? z : 100) - ZOOM_STEP));
  }, []);

  const toggleThumbnails = useCallback(() => {
    setShowThumbnails((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(THUMBNAILS_VISIBLE_KEY, next ? "1" : "0");
      } catch {
        // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
      }
      return next;
    });
  }, []);

  const togglePageBar = useCallback(() => {
    setShowPageBar((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PAGEBAR_VISIBLE_KEY, next ? "1" : "0");
      } catch {
        // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
      }
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    onProgress({ pageIndex, pageCount: archive.pageCount, zoom, doublePage });
  }, [pageIndex, archive.pageCount, zoom, doublePage, onProgress]);

  // Like CDisplayEx: render with the browser's fast default resample while
  // the zoom level is actively changing, then upgrade to a sharper filter a
  // moment after it settles (see .reader__image--sharp). Each zoom change
  // resets the timer, so a fast run of ctrl+wheel notches stays in the cheap
  // fast mode throughout and only sharpens once the user stops.
  useEffect(() => {
    setZoomSettled(false);
    const timeout = window.setTimeout(() => setZoomSettled(true), 250);
    return () => window.clearTimeout(timeout);
  }, [zoom]);

  // Loads the visible spread first, then prefetches a small surrounding window in
  // the background, and evicts anything cached further away to bound memory usage.
  useEffect(() => {
    let cancelled = false;
    const pageCount = archive.pageCount;
    const priority = currentSpread;
    const radiusMin = Math.max(0, pageIndex - PREFETCH_RADIUS);
    const radiusMax = Math.min(pageCount - 1, pageIndex + PREFETCH_RADIUS);
    const keepMin = Math.max(0, pageIndex - KEEP_RADIUS);
    const keepMax = Math.min(pageCount - 1, pageIndex + KEEP_RADIUS);

    archive.evictOutside(keepMin, keepMax);

    async function loadIndex(index: number) {
      if (archive.peekPage(index)) return;
      try {
        await archive.getPage(index);
        if (!cancelled) {
          setFailedPages((prev) => (prev.has(index) ? without(prev, index) : prev));
          bumpVersion();
        }
      } catch {
        if (!cancelled) {
          setFailedPages((prev) => (prev.has(index) ? prev : new Set(prev).add(index)));
        }
      }
    }

    (async () => {
      for (const index of priority) {
        if (cancelled) return;
        await loadIndex(index);
      }
      for (let index = radiusMin; index <= radiusMax; index++) {
        if (cancelled) return;
        if (priority.includes(index)) continue;
        await loadIndex(index);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [archive, pageIndex, currentSpread]);

  // Every action a key combo can trigger, keyed by the same action ids used
  // in lib/shortcuts.ts — the actual combo each one fires on is looked up via
  // comboToAction below, so customizing a shortcut never touches this map.
  const actionHandlers = useMemo<Record<string, () => void>>(
    () => ({
      nextPage: goNext,
      prevPage: goPrev,
      firstPage: goFirst,
      lastPage: goLast,
      zoomIn,
      zoomOut,
      fitWidth: () => setZoom("fit-width"),
      fitHeight: () => setZoom("fit-height"),
      toggleDoublePage: () => setDoublePage((v) => !v),
      toggleFullscreen,
      toggleThumbnails,
      togglePageBar,
      openFile: () => openFileInputRef.current?.click(),
      closeReader: onClose,
    }),
    [goNext, goPrev, goFirst, goLast, zoomIn, zoomOut, toggleFullscreen, toggleThumbnails, togglePageBar, onClose]
  );

  const comboToAction = useMemo(() => buildComboToActionMap(shortcutOverrides), [shortcutOverrides]);

  useEffect(() => {
    if (showSettings) return;
    function onKeyDown(e: KeyboardEvent) {
      if (document.activeElement instanceof HTMLInputElement) return;
      const combo = comboFromEvent(e);
      const actionId = combo && comboToAction.get(combo);
      const handler = actionId && actionHandlers[actionId];
      if (!handler) return;
      e.preventDefault();
      handler();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showSettings, comboToAction, actionHandlers]);

  // Ctrl+wheel always zooms the comic page instead of the browser/WebView's
  // own page zoom — attached to the whole reader, not just the image
  // viewport, so the gesture is caught even over the toolbar (otherwise the
  // WebView's native zoom could still slip through there). Kept as its own
  // listener (rather than a branch inside the viewport's wheel handler below)
  // so it never double-fires: both listening on overlapping elements would
  // otherwise each react to the same bubbling event.
  //
  // Before changing the zoom, the point under the cursor is recorded as a
  // fraction of the scrollable content (not a pixel offset, since the
  // content's size is about to change) — the layout effect below then
  // restores that same fraction under the cursor once the resized image has
  // committed, so zooming anchors on the mouse instead of the top-left corner.
  useEffect(() => {
    const el = containerRef.current;
    const viewport = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || Math.abs(e.deltaY) < 4) return;
      e.preventDefault();
      if (viewport && viewport.scrollWidth > 0 && viewport.scrollHeight > 0) {
        const rect = viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        zoomAnchorRef.current = {
          mouseX,
          mouseY,
          fractionX: (viewport.scrollLeft + mouseX) / viewport.scrollWidth,
          fractionY: (viewport.scrollTop + mouseY) / viewport.scrollHeight,
        };
      }
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomIn, zoomOut]);

  // Restores the cursor-anchored scroll position queued by the ctrl+wheel
  // handler above, once the newly-resized image has committed. A layout
  // effect (not a rAF/timeout) so it reads the freshly-committed scrollWidth/
  // scrollHeight synchronously before the browser paints — same reasoning as
  // the page-turn scroll-restore effect further down.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const anchor = zoomAnchorRef.current;
    if (!viewport || !anchor) return;
    zoomAnchorRef.current = null;
    viewport.scrollLeft = anchor.fractionX * viewport.scrollWidth - anchor.mouseX;
    viewport.scrollTop = anchor.fractionY * viewport.scrollHeight - anchor.mouseY;
  }, [zoom]);

  // Wheel scrolls within a zoomed page like a normal scroll area; only once
  // the page is already at its top/bottom edge does the wheel turn to the
  // next/previous page (and lands at the matching edge of that page). A short
  // cooldown on the page-turn keeps one wheel notch/trackpad flick from
  // firing several turns at once. Ctrl+wheel is handled by the separate
  // listener above and never reaches here at all — preventDefault() there
  // stops the browser from also emitting a synthetic non-ctrl scroll.
  // Alt+wheel pans the page horizontally instead (e.g. a wide double-page
  // spread) and never turns pages either.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < 4) return;
      if (e.altKey) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
        return;
      }
      const goingDown = e.deltaY > 0;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((goingDown && !atBottom) || (!goingDown && !atTop)) return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheelRef.current < 400) return;
      lastWheelRef.current = now;
      pendingScrollRef.current = goingDown ? "top" : "bottom";
      if (goingDown) goNext();
      else goPrev();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [goNext, goPrev]);

  // Applies the top/bottom landing spot queued by the wheel handler once the
  // new page has swapped in. useLayoutEffect (not a rAF/timeout) so it reads
  // the freshly-committed layout synchronously before the browser paints.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    const pending = pendingScrollRef.current;
    if (!el || !pending) return;
    pendingScrollRef.current = null;
    el.scrollTop = pending === "top" ? 0 : el.scrollHeight;
  }, [pageIndex]);

  // PDF-viewer-style hand-drag panning: click and drag the page to scroll it
  // when zoomed in past the viewport, instead of relying on scrollbars.
  const onViewportPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = viewportRef.current;
    if (!el) return;
    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    setIsPanning(true);
    // Capture keeps the drag going even if the pointer strays outside the
    // viewport mid-gesture; harmless to skip if the browser refuses it.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const onViewportPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const el = viewportRef.current;
    if (!pan || !el || pan.pointerId !== e.pointerId) return;
    el.scrollLeft = pan.scrollLeft - (e.clientX - pan.startX);
    el.scrollTop = pan.scrollTop - (e.clientY - pan.startY);
  }, []);

  const endViewportPan = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (panRef.current?.pointerId !== e.pointerId) return;
    panRef.current = null;
    setIsPanning(false);
    try {
      el?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const zoomLabel = typeof zoom === "number" ? `${zoom}%` : zoom === "fit-width" ? "Largeur" : "Hauteur";
  const imageClass = `${typeof zoom === "number" ? "reader__image reader__image--scaled" : `reader__image reader__image--${zoom}`}${zoomSettled ? " reader__image--sharp" : ""}`;
  const imageStyle = typeof zoom === "number" ? { width: `${zoom}%` } : undefined;

  return (
    <div className="reader" ref={containerRef}>
      <input
        ref={openFileInputRef}
        type="file"
        accept=".cbz,.zip,.cbr,.rar"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onOpenFile(file);
          e.target.value = "";
        }}
      />
      <header className="toolbar">
        <div className="toolbar__menus">
          <ToolbarMenu label="Fichier">
            <button type="button" onClick={() => openFileInputRef.current?.click()}>
              Ouvrir un fichier…
            </button>
            <button type="button" onClick={onClose}>
              Fermer
            </button>
          </ToolbarMenu>
          <ToolbarMenu label="Lire">
            <button type="button" onClick={goPrev} disabled={currentSpreadIdx === 0}>
              ← Page précédente
            </button>
            <button type="button" onClick={goNext} disabled={currentSpreadIdx === spreads.length - 1}>
              Page suivante →
            </button>
            <button type="button" onClick={() => setDoublePage((v) => !v)} className={doublePage ? "active" : ""}>
              Double page
            </button>
            <button type="button" onClick={toggleThumbnails} className={showThumbnails ? "active" : ""}>
              Vignettes
            </button>
            <button type="button" onClick={togglePageBar} className={showPageBar ? "active" : ""}>
              Curseur de page
            </button>
          </ToolbarMenu>
          <ToolbarMenu label="Options">
            <div className="toolbar-menu__label">Zoom : {zoomLabel}</div>
            <button type="button" onClick={zoomOut}>
              − Zoom arrière
            </button>
            <button type="button" onClick={zoomIn}>
              + Zoom avant
            </button>
            <button type="button" onClick={() => setZoom("fit-width")} className={zoom === "fit-width" ? "active" : ""}>
              Largeur
            </button>
            <button type="button" onClick={() => setZoom("fit-height")} className={zoom === "fit-height" ? "active" : ""}>
              Hauteur
            </button>
            <hr className="toolbar-menu__divider" />
            <button type="button" onClick={() => setShowSettings(true)}>
              Configuration…
            </button>
          </ToolbarMenu>
        </div>
        <div className="toolbar__nav-icons">
          <button type="button" className="toolbar__icon-btn" onClick={goFirst} disabled={currentSpreadIdx === 0} aria-label="Première page" title="Première page">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="4" x2="5" y2="20" />
              <polygon points="19 4 9 12 19 20" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button type="button" className="toolbar__icon-btn" onClick={goPrev} disabled={currentSpreadIdx === 0} aria-label="Page précédente" title="Page précédente">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 4 7 12 15 20" />
            </svg>
          </button>
          <button type="button" className="toolbar__icon-btn" onClick={goNext} disabled={currentSpreadIdx === spreads.length - 1} aria-label="Page suivante" title="Page suivante">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 4 17 12 9 20" />
            </svg>
          </button>
          <button type="button" className="toolbar__icon-btn" onClick={goLast} disabled={currentSpreadIdx === spreads.length - 1} aria-label="Dernière page" title="Dernière page">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="4" x2="19" y2="20" />
              <polygon points="5 4 15 12 5 20" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
        <span className="toolbar__separator" />
        <div className="toolbar__icons">
          <button
            type="button"
            className={`toolbar__icon-btn${doublePage ? " active" : ""}`}
            onClick={() => setDoublePage((v) => !v)}
            aria-label="Double page"
            title="Double page"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="9" height="16" rx="1" />
              <rect x="13" y="4" width="9" height="16" rx="1" />
            </svg>
          </button>
          <button
            type="button"
            className={`toolbar__icon-btn${fullscreen ? " active" : ""}`}
            onClick={toggleFullscreen}
            aria-label="Plein écran"
            title="Plein écran"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="8 3 3 3 3 8" />
              <polyline points="16 3 21 3 21 8" />
              <polyline points="3 16 3 21 8 21" />
              <polyline points="21 16 21 21 16 21" />
            </svg>
          </button>
          <button
            type="button"
            className="toolbar__icon-btn toolbar__icon-btn--close"
            onClick={onClose}
            aria-label="Fermer"
            title="Fermer"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="4" x2="20" y2="20" />
              <line x1="20" y1="4" x2="4" y2="20" />
            </svg>
          </button>
        </div>
      </header>

      <div className="reader__body">
        <div className="reader__stage">
          <div
            className={`reader__viewport${isPanning ? " reader__viewport--panning" : ""}`}
            ref={viewportRef}
            onPointerDown={onViewportPointerDown}
            onPointerMove={onViewportPointerMove}
            onPointerUp={endViewportPan}
            onPointerCancel={endViewportPan}
          >
            <div className="reader__spread">
              {currentSpread.map((idx) => {
                const page = archive.peekPage(idx);
                if (page) {
                  return (
                    <img
                      key={idx}
                      src={page.url}
                      alt={`Page ${idx + 1}`}
                      className={imageClass}
                      style={imageStyle}
                      draggable={false}
                    />
                  );
                }
                return (
                  <div key={idx} className="reader__page-placeholder">
                    {failedPages.has(idx) ? (
                      <span className="reader__page-error">Erreur de chargement</span>
                    ) : (
                      <span className="reader__page-spinner" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {showThumbnails && (
          <ReaderThumbnails
            archive={archive}
            currentIndex={pageIndex}
            onSelect={setPageIndex}
            onClose={toggleThumbnails}
          />
        )}
      </div>

      {showPageBar && (
        <div className="reader__pagebar">
          <input
            ref={pageInputRef}
            type="number"
            className="reader__pagebar-input"
            value={pageInput}
            min={1}
            max={archive.pageCount}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitPageInput();
                pageInputRef.current?.blur();
              }
            }}
            onBlur={commitPageInput}
            aria-label="Aller à la page"
          />
          <span className="reader__pagebar-count">/ {archive.pageCount}</span>
          <input
            type="range"
            className="reader__pagebar-slider"
            min={1}
            max={archive.pageCount}
            value={pageIndex + 1}
            onChange={(e) => setPageIndex(Number(e.target.value) - 1)}
            aria-label="Curseur de page"
          />
        </div>
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} onShortcutsChange={setShortcutOverrides} />
      )}
    </div>
  );
}

function without(set: Set<number>, value: number): Set<number> {
  const next = new Set(set);
  next.delete(value);
  return next;
}
