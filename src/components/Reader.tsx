import { CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { OpenedArchive } from "../lib/archive";
import { Bookmark, BOOKMARK_COLOR_HEX, BookmarkColor, defaultBookmark } from "../lib/bookmarks";
import { COMFORT_FILTERS, ComfortFilterId } from "../lib/comfortFilter";
import { buildImageTransform, CropRect, detectMarginCrop, isNoCrop, isSpreadAspect, NO_CROP, probeDimensions } from "../lib/imageAnalysis";
import { PerformancePreset } from "../lib/performance";
import { ReaderProgress, Rotation, ZoomMode } from "../lib/progress";
import { buildComboToActionMap, comboFromEvent, ShortcutOverrides } from "../lib/shortcuts";
import { buildSpreads, findSpreadIndex } from "../lib/spreads";
import BookmarkPanel from "./BookmarkPanel";
import ComicInfoModal from "./ComicInfoModal";
import ReaderThumbnails from "./ReaderThumbnails";
import ToolbarMenu from "./ToolbarMenu";

interface Props {
  archive: OpenedArchive;
  initialProgress: ReaderProgress | null;
  onProgress: (progress: ReaderProgress) => void;
  onClose: () => void;
  onOpenFile: (file: File) => void;
  shortcutOverrides: ShortcutOverrides;
  onOpenSettings: () => void;
  settingsOpen: boolean;
  performancePreset: PerformancePreset;
  comfortFilter: ComfortFilterId;
  initialBookmarks: Bookmark[];
  onBookmarksChange: (bookmarks: Bookmark[]) => void;
}

const ZOOM_MIN = 25;
const ZOOM_MAX = 400;
const ZOOM_STEP = 10;
const SLIDESHOW_INTERVAL_MS = 4000;

const THUMBNAILS_VISIBLE_KEY = "cbreader:readerThumbnailsVisible";
const PAGEBAR_VISIBLE_KEY = "cbreader:readerPageBarVisible";
const MANGA_MODE_KEY = "cbreader:mangaMode";
const CONTINUOUS_SCROLL_KEY = "cbreader:continuousScroll";
const BOOKMARK_PANEL_VISIBLE_KEY = "cbreader:readerBookmarkPanelVisible";
const AUTO_CROP_MARGINS_KEY = "cbreader:autoCropMargins";
const AUTO_SPLIT_SPREADS_KEY = "cbreader:autoSplitSpreads";

export default function Reader({
  archive,
  initialProgress,
  onProgress,
  onClose,
  onOpenFile,
  shortcutOverrides,
  onOpenSettings,
  settingsOpen,
  performancePreset,
  comfortFilter,
  initialBookmarks,
  onBookmarksChange,
}: Props) {
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
  const [mangaMode, setMangaMode] = useState(() => localStorage.getItem(MANGA_MODE_KEY) === "1");
  const [continuousScroll, setContinuousScroll] = useState(() => localStorage.getItem(CONTINUOUS_SCROLL_KEY) === "1");
  const [rotation, setRotation] = useState<Rotation>(initialProgress?.rotation ?? 0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialBookmarks);
  const [showBookmarkPanel, setShowBookmarkPanel] = useState(() => localStorage.getItem(BOOKMARK_PANEL_VISIBLE_KEY) === "1");
  const [showInfo, setShowInfo] = useState(false);
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [autoCropMargins, setAutoCropMargins] = useState(() => localStorage.getItem(AUTO_CROP_MARGINS_KEY) === "1");
  const [autoSplitSpreads, setAutoSplitSpreads] = useState(() => localStorage.getItem(AUTO_SPLIT_SPREADS_KEY) === "1");
  // Which half of a wide (spread) page is showing in single-page mode when
  // auto-split is on — irrelevant/unused otherwise. Reset to 0 by every
  // explicit navigation; only goNext/goPrev step it to 1 and back.
  const [subPage, setSubPage] = useState<0 | 1>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const openFileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastWheelRef = useRef(0);
  const pendingScrollRef = useRef<"top" | "bottom" | null>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const zoomAnchorRef = useRef<{ mouseX: number; mouseY: number; fractionX: number; fractionY: number } | null>(null);
  // Continuous-scroll mode: DOM nodes for every page (for scrollIntoView) and
  // the pending target of an explicit navigation (goNext/thumbnail click/...)
  // so the scroll-restore effect knows to jump there instead of leaving the
  // observer-driven pageIndex update as the only signal.
  const pageElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollRequestRef = useRef<number | null>(null);
  // Per-page results from lib/imageAnalysis.ts, populated lazily as pages
  // load (see the effect near the prefetch loader below) — natural
  // dimensions drive auto-split's "is this page a spread?" check, and the
  // margin-crop cache avoids re-analyzing the same page's pixels every
  // render (or every time it's revisited).
  const pageDimensionsRef = useRef<Map<number, { width: number; height: number }>>(new Map());
  const marginCropRef = useRef<Map<number, CropRect>>(new Map());
  const analyzedForCropRef = useRef<Set<number>>(new Set());

  const spreads = useMemo(() => buildSpreads(archive.pageCount, doublePage), [archive.pageCount, doublePage]);
  const currentSpreadIdx = findSpreadIndex(spreads, pageIndex);
  const currentSpread = spreads[currentSpreadIdx] ?? [0];

  // Jumps to an explicit page (thumbnail click, page-bar input/slider,
  // first/last) — in continuous-scroll mode this also queues a scrollIntoView
  // so the viewport actually moves there, not just the tracked pageIndex.
  // Always lands on a wide page's first half, never mid-split.
  const navigateTo = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), archive.pageCount - 1);
      setPageIndex(clamped);
      setSubPage(0);
      if (continuousScroll) scrollRequestRef.current = clamped;
    },
    [continuousScroll, archive.pageCount]
  );

  const isPageWide = useCallback((index: number) => {
    const dim = pageDimensionsRef.current.get(index);
    return !!dim && isSpreadAspect(dim.width, dim.height);
  }, []);

  // In continuous-scroll mode there are no spreads to step through — every
  // page is already on screen, so "next/prev" just moves the tracked index by
  // one and scrolls there. In paged mode, navigation steps by spread instead.
  // Auto-split intercepts both, in single-page mode only: stepping past the
  // first half of a wide page shows its second half before moving on to the
  // next real page, and stepping back does the reverse.
  const splitActive = autoSplitSpreads && !doublePage && !continuousScroll;

  const goNext = useCallback(() => {
    if (splitActive && subPage === 0 && isPageWide(pageIndex)) {
      setSubPage(1);
      return;
    }
    setSubPage(0);
    if (continuousScroll) {
      navigateTo(pageIndex + 1);
      return;
    }
    const idx = findSpreadIndex(spreads, pageIndex);
    if (idx < spreads.length - 1) setPageIndex(spreads[idx + 1][0]);
  }, [splitActive, subPage, isPageWide, continuousScroll, navigateTo, spreads, pageIndex]);

  const goPrev = useCallback(() => {
    if (splitActive && subPage === 1) {
      setSubPage(0);
      return;
    }
    setSubPage(0);
    if (continuousScroll) {
      navigateTo(pageIndex - 1);
      return;
    }
    const idx = findSpreadIndex(spreads, pageIndex);
    if (idx > 0) setPageIndex(spreads[idx - 1][0]);
  }, [splitActive, subPage, continuousScroll, navigateTo, spreads, pageIndex]);

  // A wide page's still-unseen second half means there's somewhere left to
  // go even at the last/first spread — the plain currentSpreadIdx bounds
  // check alone would wrongly disable Next on a split page's first half.
  const canGoNext = (splitActive && subPage === 0 && isPageWide(pageIndex)) || currentSpreadIdx < spreads.length - 1;
  const canGoPrev = (splitActive && subPage === 1) || currentSpreadIdx > 0;

  const goFirst = useCallback(() => navigateTo(0), [navigateTo]);
  const goLast = useCallback(() => {
    if (continuousScroll) {
      navigateTo(archive.pageCount - 1);
      return;
    }
    setPageIndex(spreads[spreads.length - 1]?.[0] ?? 0);
  }, [continuousScroll, navigateTo, spreads, archive.pageCount]);

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
    navigateTo(clamped - 1);
    setPageInput(String(clamped));
  }, [pageInput, pageIndex, archive.pageCount, navigateTo]);

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

  const toggleMangaMode = useCallback(() => {
    setMangaMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MANGA_MODE_KEY, next ? "1" : "0");
      } catch {
        // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
      }
      return next;
    });
  }, []);

  const toggleContinuousScroll = useCallback(() => {
    setContinuousScroll((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CONTINUOUS_SCROLL_KEY, next ? "1" : "0");
      } catch {
        // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
      }
      return next;
    });
  }, []);

  const toggleAutoCropMargins = useCallback(() => {
    setAutoCropMargins((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_CROP_MARGINS_KEY, next ? "1" : "0");
      } catch {
        // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
      }
      return next;
    });
  }, []);

  const toggleAutoSplitSpreads = useCallback(() => {
    setAutoSplitSpreads((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_SPLIT_SPREADS_KEY, next ? "1" : "0");
      } catch {
        // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
      }
      setSubPage(0);
      return next;
    });
  }, []);

  const rotatePage = useCallback(() => {
    setRotation((r) => (((r + 90) % 360) as Rotation));
  }, []);

  const rotatePageCCW = useCallback(() => {
    setRotation((r) => (((r + 270) % 360) as Rotation));
  }, []);

  const resetRotation = useCallback(() => setRotation(0), []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    onProgress({ pageIndex, pageCount: archive.pageCount, zoom, doublePage, rotation });
  }, [pageIndex, archive.pageCount, zoom, doublePage, rotation, onProgress]);

  useEffect(() => {
    onBookmarksChange(bookmarks);
  }, [bookmarks, onBookmarksChange]);

  const isBookmarked = bookmarks.some((b) => b.pageIndex === pageIndex);

  const toggleBookmark = useCallback(() => {
    setBookmarks((prev) =>
      prev.some((b) => b.pageIndex === pageIndex) ? prev.filter((b) => b.pageIndex !== pageIndex) : [...prev, defaultBookmark(pageIndex)]
    );
  }, [pageIndex]);

  const removeBookmark = useCallback((index: number) => {
    setBookmarks((prev) => prev.filter((b) => b.pageIndex !== index));
  }, []);

  const renameBookmark = useCallback((index: number, label: string) => {
    setBookmarks((prev) => prev.map((b) => (b.pageIndex === index ? { ...b, label } : b)));
  }, []);

  const setBookmarkColor = useCallback((index: number, color: BookmarkColor) => {
    setBookmarks((prev) => prev.map((b) => (b.pageIndex === index ? { ...b, color } : b)));
  }, []);

  const toggleBookmarkPanel = useCallback(() => {
    setShowBookmarkPanel((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(BOOKMARK_PANEL_VISIBLE_KEY, next ? "1" : "0");
      } catch {
        // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
      }
      return next;
    });
  }, []);

  // Jumps to the nearest bookmark strictly after/before the current page —
  // skips over unbookmarked pages entirely, unlike goNext/goPrev.
  const goToNextBookmark = useCallback(() => {
    const next = bookmarks.map((b) => b.pageIndex).filter((p) => p > pageIndex).sort((a, b) => a - b)[0];
    if (next !== undefined) navigateTo(next);
  }, [bookmarks, pageIndex, navigateTo]);

  const goToPrevBookmark = useCallback(() => {
    const candidates = bookmarks.map((b) => b.pageIndex).filter((p) => p < pageIndex).sort((a, b) => a - b);
    const prev = candidates[candidates.length - 1];
    if (prev !== undefined) navigateTo(prev);
  }, [bookmarks, pageIndex, navigateTo]);

  const exportCurrentPage = useCallback(() => {
    const page = archive.peekPage(pageIndex);
    if (!page) return;
    const ext = page.name.split(".").pop() || "png";
    const a = document.createElement("a");
    a.href = page.url;
    a.download = `page_${String(pageIndex + 1).padStart(3, "0")}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [archive, pageIndex]);

  const toggleSlideshow = useCallback(() => setSlideshowActive((v) => !v), []);

  // Re-armed every time pageIndex changes (manual navigation or the timer's
  // own previous tick alike), so a manual page turn while the slideshow is
  // running restarts the countdown instead of firing early. Turns itself off
  // at the last page/spread instead of looping.
  useEffect(() => {
    if (!slideshowActive) return;
    const atEnd = continuousScroll ? pageIndex >= archive.pageCount - 1 : currentSpreadIdx === spreads.length - 1;
    if (atEnd) {
      setSlideshowActive(false);
      return;
    }
    const timeout = window.setTimeout(() => goNext(), SLIDESHOW_INTERVAL_MS);
    return () => window.clearTimeout(timeout);
  }, [slideshowActive, pageIndex, continuousScroll, archive.pageCount, currentSpreadIdx, spreads.length, goNext]);

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
    const radiusMin = Math.max(0, pageIndex - performancePreset.prefetchRadius);
    const radiusMax = Math.min(pageCount - 1, pageIndex + performancePreset.prefetchRadius);
    const keepMin = Math.max(0, pageIndex - performancePreset.keepRadius);
    const keepMax = Math.min(pageCount - 1, pageIndex + performancePreset.keepRadius);

    archive.evictOutside(keepMin, keepMax);

    // Natural dimensions (for auto-split's "is this a spread?" check) are
    // always probed — a plain Image load, cheap enough to never gate behind
    // a toggle. The margin-crop scan is real pixel work, so it only runs
    // while auto-crop is on, and analyzedForCropRef keeps it from repeating
    // for a page already analyzed (including once for each toggle-on).
    async function analyzePage(index: number) {
      const page = archive.peekPage(index);
      if (!page) return;
      if (!pageDimensionsRef.current.has(index)) {
        try {
          const dim = await probeDimensions(page.url);
          if (!cancelled) {
            pageDimensionsRef.current.set(index, dim);
            bumpVersion();
          }
        } catch {
          // dimensions indisponibles - le découpage auto ignore simplement cette page
        }
      }
      if (autoCropMargins && !analyzedForCropRef.current.has(index)) {
        analyzedForCropRef.current.add(index);
        try {
          const crop = await detectMarginCrop(page.url);
          if (!cancelled) {
            marginCropRef.current.set(index, crop);
            bumpVersion();
          }
        } catch {
          // analyse impossible - pas de rognage pour cette page, sans bloquer la lecture
        }
      }
    }

    async function loadIndex(index: number) {
      if (!archive.peekPage(index)) {
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
          return;
        }
      }
      if (!cancelled) await analyzePage(index);
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
  }, [archive, pageIndex, currentSpread, performancePreset, autoCropMargins]);

  // Every action a key combo can trigger, keyed by the same action ids used
  // in lib/shortcuts.ts — the actual combo each one fires on is looked up via
  // comboToAction below, so customizing a shortcut never touches this map.
  const actionHandlers = useMemo<Record<string, () => void>>(
    () => ({
      // In manga mode, the physical Left/Right arrow keys (bound to
      // prevPage/nextPage by default) are swapped so pressing the key that
      // visually points "toward the next page" (left, in a right-to-left
      // layout) actually advances — everything else (icon buttons, Home/End)
      // keeps its literal meaning since those aren't tied to a physical side.
      nextPage: mangaMode ? goPrev : goNext,
      prevPage: mangaMode ? goNext : goPrev,
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
      toggleMangaMode,
      toggleContinuousScroll,
      rotatePage,
      rotatePageCCW,
      toggleAutoCropMargins,
      toggleAutoSplitSpreads,
      toggleBookmark,
      toggleBookmarkPanel,
      nextBookmark: goToNextBookmark,
      prevBookmark: goToPrevBookmark,
      toggleSlideshow,
      showComicInfo: () => setShowInfo(true),
      exportCurrentPage,
      openFile: () => openFileInputRef.current?.click(),
      closeReader: onClose,
    }),
    [
      mangaMode,
      goNext,
      goPrev,
      goFirst,
      goLast,
      zoomIn,
      zoomOut,
      toggleFullscreen,
      toggleThumbnails,
      togglePageBar,
      toggleMangaMode,
      toggleContinuousScroll,
      rotatePage,
      rotatePageCCW,
      toggleAutoCropMargins,
      toggleAutoSplitSpreads,
      toggleBookmark,
      toggleBookmarkPanel,
      goToNextBookmark,
      goToPrevBookmark,
      toggleSlideshow,
      exportCurrentPage,
      onClose,
    ]
  );

  const comboToAction = useMemo(() => buildComboToActionMap(shortcutOverrides), [shortcutOverrides]);

  useEffect(() => {
    if (settingsOpen || showInfo) return;
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
  }, [settingsOpen, showInfo, comboToAction, actionHandlers]);

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
    // Continuous scroll has no "edge" to turn a page at — the wheel just
    // scrolls the stacked column natively, so this listener stays detached.
    if (!el || continuousScroll) return;
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
  }, [goNext, goPrev, continuousScroll]);

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

  // Continuous-scroll mode: tracks which page is most visible as the user
  // scrolls the stacked column, and keeps it as the "current" pageIndex (for
  // progress-saving, the thumbnails highlight, the page bar, and to drive
  // which pages the prefetch effect above keeps loaded).
  useEffect(() => {
    if (!continuousScroll) return;
    const root = viewportRef.current;
    if (!root) return;
    // A page image is usually taller than the viewport, so it often never
    // crosses a coarse ratio threshold (e.g. 25%) even while it's clearly the
    // most-visible one on screen — the observer firing is just used as the
    // "something changed" signal, and the actual "which page is current" pick
    // is a direct getBoundingClientRect measurement over every tracked page,
    // not the (possibly stale/sparse) entries batch itself.
    const pickCurrent = () => {
      const rootRect = root.getBoundingClientRect();
      let best: { index: number; visible: number } | null = null;
      for (const [idx, el] of pageElsRef.current) {
        const r = el.getBoundingClientRect();
        const visible = Math.min(r.bottom, rootRect.bottom) - Math.max(r.top, rootRect.top);
        if (visible > 0 && (!best || visible > best.visible)) best = { index: idx, visible };
      }
      if (best) setPageIndex(best.index);
    };
    const observer = new IntersectionObserver(pickCurrent, {
      root,
      threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    });
    for (const el of pageElsRef.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [continuousScroll, archive.pageCount]);

  // Consumes a scroll request queued by navigateTo/goNext/goPrev while in
  // continuous mode — a layout effect so it jumps before the browser paints,
  // same reasoning as the top/bottom scroll-restore effect above.
  useLayoutEffect(() => {
    if (!continuousScroll) return;
    const target = scrollRequestRef.current;
    if (target === null) return;
    scrollRequestRef.current = null;
    pageElsRef.current.get(target)?.scrollIntoView({ block: "start" });
  }, [pageIndex, continuousScroll]);

  // Jumps to the current page once when continuous mode is switched on (e.g.
  // resuming mid-comic) — kept separate from the scroll-request effect above
  // so it only fires on the mode toggle itself, not on every subsequent
  // observer-driven pageIndex update while already in continuous mode.
  useEffect(() => {
    if (!continuousScroll) return;
    pageElsRef.current.get(pageIndex)?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuousScroll]);

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
  const filterCss = COMFORT_FILTERS.find((f) => f.id === comfortFilter)?.filter ?? undefined;
  // A page rotated 90/270° swaps which screen axis its width/height fill —
  // fit-width sizing (full container width) only still fits after rotation
  // if it's applied as fit-height *before* the rotate() transform, and vice
  // versa, so the fit mode used for sizing is swapped for sideways rotations.
  const sideways = rotation === 90 || rotation === 270;
  const sizingZoom: ZoomMode = sideways ? (zoom === "fit-width" ? "fit-height" : zoom === "fit-height" ? "fit-width" : zoom) : zoom;
  const imageClass = `${typeof sizingZoom === "number" ? "reader__image reader__image--scaled" : `reader__image reader__image--${sizingZoom}`}${zoomSettled ? " reader__image--sharp" : ""}`;
  const continuousImageClass = `reader__continuous-image${zoomSettled ? " reader__image--sharp" : ""}`;

  // Which crop rect (if any) applies to a given archive page index: a wide
  // page being auto-split takes priority over margin-cropping (the two
  // aren't composed — see lib/imageAnalysis.ts's module comment for why),
  // and only ever applies to the page currently on screen. subPage 0 is
  // "read first": the left half normally, the right half in manga mode.
  const getCropForPage = (index: number): CropRect => {
    if (splitActive && index === pageIndex && isPageWide(index)) {
      const firstHalfIsLeft = !mangaMode;
      const showLeft = subPage === 0 ? firstHalfIsLeft : !firstHalfIsLeft;
      return showLeft ? { top: 0, right: 0.5, bottom: 0, left: 0 } : { top: 0, right: 0, bottom: 0, left: 0.5 };
    }
    if (autoCropMargins) return marginCropRef.current.get(index) ?? NO_CROP;
    return NO_CROP;
  };

  // clip-path+transform crops visually without changing the <img>'s layout
  // box, which is still sized from its *un*cropped intrinsic aspect ratio —
  // left alone, that would leave fit-width/fit-height sizing computing the
  // wrong height/width for the now-smaller visible content. Overriding
  // aspect-ratio (when the page's natural size is already known) fixes the
  // box itself to match what's actually visible.
  const aspectRatioFor = (index: number, crop: CropRect): string | undefined => {
    const dim = pageDimensionsRef.current.get(index);
    if (!dim || isNoCrop(crop)) return undefined;
    const w = dim.width * (1 - crop.left - crop.right);
    const h = dim.height * (1 - crop.top - crop.bottom);
    return w > 0 && h > 0 ? `${w} / ${h}` : undefined;
  };

  const getImageStyle = (index: number): CSSProperties => {
    const crop = getCropForPage(index);
    const { transform, clipPath } = buildImageTransform(rotation, crop);
    const aspectRatio = aspectRatioFor(index, crop);
    return {
      ...(typeof zoom === "number" ? { width: `${zoom}%` } : {}),
      ...(transform ? { transform } : {}),
      ...(clipPath ? { clipPath } : {}),
      ...(filterCss ? { filter: filterCss } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
    };
  };

  // Continuous scroll never splits (see the effect above), only crops.
  const getContinuousImageStyle = (index: number): CSSProperties => {
    const crop = autoCropMargins ? marginCropRef.current.get(index) ?? NO_CROP : NO_CROP;
    const { transform, clipPath } = buildImageTransform(rotation, crop);
    const aspectRatio = aspectRatioFor(index, crop);
    return {
      width: typeof zoom === "number" ? `${zoom}%` : "100%",
      ...(transform ? { transform } : {}),
      ...(clipPath ? { clipPath } : {}),
      ...(filterCss ? { filter: filterCss } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
    };
  };

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
            <button type="button" onClick={() => setShowInfo(true)}>
              Informations…
            </button>
            <button type="button" onClick={exportCurrentPage}>
              Exporter la page courante
            </button>
            <hr className="toolbar-menu__divider" />
            <button type="button" onClick={onClose}>
              Fermer
            </button>
          </ToolbarMenu>
          <ToolbarMenu label="Lire">
            <button type="button" onClick={goPrev} disabled={!canGoPrev}>
              ← Page précédente
            </button>
            <button type="button" onClick={goNext} disabled={!canGoNext}>
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
            <hr className="toolbar-menu__divider" />
            <button type="button" onClick={toggleMangaMode} className={mangaMode ? "active" : ""}>
              Mode manga (droite → gauche)
            </button>
            <button type="button" onClick={toggleContinuousScroll} className={continuousScroll ? "active" : ""}>
              Défilement continu
            </button>
            <button type="button" onClick={toggleSlideshow} className={slideshowActive ? "active" : ""}>
              Diaporama automatique
            </button>
            <hr className="toolbar-menu__divider" />
            <button type="button" onClick={toggleBookmark} className={isBookmarked ? "active" : ""}>
              {isBookmarked ? "Retirer le marque-page" : "Marque-page sur cette page"}
            </button>
            <button type="button" onClick={toggleBookmarkPanel} className={showBookmarkPanel ? "active" : ""}>
              Panneau des marque-pages{bookmarks.length > 0 ? ` (${bookmarks.length})` : ""}
            </button>
            <button type="button" onClick={goToPrevBookmark} disabled={!bookmarks.some((b) => b.pageIndex < pageIndex)}>
              ← Marque-page précédent
            </button>
            <button type="button" onClick={goToNextBookmark} disabled={!bookmarks.some((b) => b.pageIndex > pageIndex)}>
              Marque-page suivant →
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
            <div className="toolbar-menu__label">Rotation{rotation ? ` : ${rotation}°` : ""}</div>
            <button type="button" onClick={rotatePageCCW}>
              ↺ Pivoter (-90°)
            </button>
            <button type="button" onClick={rotatePage}>
              ↻ Pivoter (90°)
            </button>
            {rotation !== 0 && (
              <button type="button" onClick={resetRotation}>
                Réinitialiser la rotation
              </button>
            )}
            <hr className="toolbar-menu__divider" />
            <button type="button" onClick={toggleAutoCropMargins} className={autoCropMargins ? "active" : ""}>
              Rognage auto des marges
            </button>
            <button type="button" onClick={toggleAutoSplitSpreads} className={autoSplitSpreads ? "active" : ""}>
              Découpe auto des doubles pages
            </button>
            <hr className="toolbar-menu__divider" />
            <button type="button" onClick={onOpenSettings}>
              Configuration…
            </button>
          </ToolbarMenu>
        </div>
        {/* Mirrored horizontally in manga mode: since page order is still
            First→Last left-to-right in the DOM, flipping the whole group
            moves "Last" to the visual left and "First" to the visual right —
            matching an RTL book's layout — and each icon mirrors along with
            it (the chevrons end up pointing the intuitively-correct way) with
            no change to which handler each button calls. This is what makes
            manga mode visibly *do* something even outside double-page mode,
            unlike the reader__spread reorder above which only shows there. */}
        <div className="toolbar__nav-icons" style={mangaMode ? { transform: "scaleX(-1)" } : undefined}>
          <button type="button" className="toolbar__icon-btn" onClick={goFirst} disabled={currentSpreadIdx === 0} aria-label="Première page" title="Première page">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="4" x2="5" y2="20" />
              <polygon points="19 4 9 12 19 20" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button type="button" className="toolbar__icon-btn" onClick={goPrev} disabled={!canGoPrev} aria-label="Page précédente" title="Page précédente">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 4 7 12 15 20" />
            </svg>
          </button>
          <button type="button" className="toolbar__icon-btn" onClick={goNext} disabled={!canGoNext} aria-label="Page suivante" title="Page suivante">
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
            className={`toolbar__icon-btn${mangaMode ? " active" : ""}`}
            onClick={toggleMangaMode}
            aria-label="Mode manga (droite → gauche)"
            title="Mode manga (droite → gauche)"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="14 4 6 12 14 20" />
              <polyline points="20 4 12 12 20 20" />
            </svg>
          </button>
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
            className={`toolbar__icon-btn${continuousScroll ? " active" : ""}`}
            onClick={toggleContinuousScroll}
            aria-label="Défilement continu"
            title="Défilement continu"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="3" width="16" height="7" rx="1" />
              <rect x="4" y="14" width="16" height="7" rx="1" />
            </svg>
          </button>
          <span className="toolbar__separator" />
          <button
            type="button"
            className={`toolbar__icon-btn${isBookmarked ? " active" : ""}`}
            onClick={toggleBookmark}
            aria-label={isBookmarked ? "Retirer le marque-page" : "Ajouter un marque-page"}
            title={isBookmarked ? "Retirer le marque-page" : "Ajouter un marque-page"}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h12v18l-6-4-6 4V3z" fill={isBookmarked ? "currentColor" : "none"} />
            </svg>
          </button>
          <button
            type="button"
            className={`toolbar__icon-btn${showBookmarkPanel ? " active" : ""}`}
            onClick={toggleBookmarkPanel}
            aria-label="Panneau des marque-pages"
            title="Panneau des marque-pages"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h12v18l-6-4-6 4V3z" />
              <line x1="9" y1="7" x2="15" y2="7" />
            </svg>
          </button>
          <span className="toolbar__separator" />
          <button
            type="button"
            className={`toolbar__icon-btn${slideshowActive ? " active" : ""}`}
            onClick={toggleSlideshow}
            aria-label="Diaporama automatique"
            title="Diaporama automatique"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {slideshowActive ? (
                <>
                  <line x1="8" y1="4" x2="8" y2="20" />
                  <line x1="16" y1="4" x2="16" y2="20" />
                </>
              ) : (
                <polygon points="6 4 20 12 6 20" fill="currentColor" stroke="none" />
              )}
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
            {continuousScroll ? (
              <div className="reader__continuous">
                {Array.from({ length: archive.pageCount }, (_, idx) => {
                  const page = archive.peekPage(idx);
                  return (
                    <div
                      key={idx}
                      className="reader__continuous-page"
                      data-page-index={idx}
                      ref={(el) => {
                        if (el) pageElsRef.current.set(idx, el);
                        else pageElsRef.current.delete(idx);
                      }}
                    >
                      {page ? (
                        <img
                          src={page.url}
                          alt={`Page ${idx + 1}`}
                          className={continuousImageClass}
                          style={getContinuousImageStyle(idx)}
                          draggable={false}
                        />
                      ) : (
                        <div className="reader__page-placeholder">
                          {failedPages.has(idx) ? (
                            <span className="reader__page-error">Erreur de chargement</span>
                          ) : (
                            <span className="reader__page-spinner" />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              // Manga mode reverses which physical page renders on which side
              // (page N+1 left, N right) by reordering the DOM nodes
              // themselves rather than flipping flex-direction: a reversed
              // flex-direction shifts the overflow "start" edge to the other
              // side, which the margin:auto overflow fix above doesn't
              // account for — the hand-drag pan could no longer reach content
              // overflowing that side. Reordering keeps a normal row layout,
              // so scrolling/panning works exactly as in non-manga mode.
              <div className="reader__spread">
                {(mangaMode ? [...currentSpread].reverse() : currentSpread).map((idx) => {
                  const page = archive.peekPage(idx);
                  if (page) {
                    return (
                      <img
                        key={idx}
                        src={page.url}
                        alt={`Page ${idx + 1}`}
                        className={imageClass}
                        style={getImageStyle(idx)}
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
            )}
          </div>
        </div>
        {showThumbnails && (
          <ReaderThumbnails
            archive={archive}
            currentIndex={pageIndex}
            bookmarks={bookmarks}
            onSelect={navigateTo}
            onClose={toggleThumbnails}
          />
        )}
        {showBookmarkPanel && (
          <BookmarkPanel
            archive={archive}
            bookmarks={bookmarks}
            currentIndex={pageIndex}
            onSelect={navigateTo}
            onRename={renameBookmark}
            onColor={setBookmarkColor}
            onRemove={removeBookmark}
            onClose={toggleBookmarkPanel}
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
          <div className="reader__pagebar-slider-wrap">
            <input
              type="range"
              className="reader__pagebar-slider"
              min={1}
              max={archive.pageCount}
              value={pageIndex + 1}
              onChange={(e) => navigateTo(Number(e.target.value) - 1)}
              aria-label="Curseur de page"
            />
            <div className="reader__pagebar-ticks">
              {bookmarks.map((b) => (
                <span
                  key={b.pageIndex}
                  className="reader__pagebar-tick"
                  style={{
                    left: `${archive.pageCount > 1 ? (b.pageIndex / (archive.pageCount - 1)) * 100 : 0}%`,
                    background: BOOKMARK_COLOR_HEX[b.color],
                  }}
                  title={b.label}
                  onClick={() => navigateTo(b.pageIndex)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {showInfo && (
        <ComicInfoModal
          comicInfo={archive.comicInfo}
          pageCount={archive.pageCount}
          format={archive.format}
          onClose={() => setShowInfo(false)}
        />
      )}
    </div>
  );
}

function without(set: Set<number>, value: number): Set<number> {
  const next = new Set(set);
  next.delete(value);
  return next;
}
