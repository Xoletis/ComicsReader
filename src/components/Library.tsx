import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCoverPage } from "../lib/archive";
import {
  ComicEntry,
  createFolder,
  deleteEntry,
  deleteFolder,
  FolderEntry,
  importFileIntoFolder,
  isComicFile,
  isFileSystemAccessSupported,
  listEntries,
  loadDirectoryHandle,
  moveEntry,
  pickFilesToImport,
  pickLibraryFolder,
  queryPermission,
  renameEntry,
  requestPermission,
  validateEntryName,
} from "../lib/library";
import { folderColorKey, loadFolderColors, saveFolderColor } from "../lib/folderColors";
import { loadProgressByKey, ReaderProgress, renameProgressKey } from "../lib/progress";
import FolderColorModal from "./FolderColorModal";
import FolderIcon from "./FolderIcon";
import InfoModal from "./InfoModal";
import LibraryTree from "./LibraryTree";
import MoveFolderModal, { MoveItem, PathEntry } from "./MoveFolderModal";
import PromptModal from "./PromptModal";
import SearchModal from "./SearchModal";

type Status = "checking" | "unsupported" | "disconnected" | "needs-permission" | "connected";

const COVER_CONCURRENCY = 4;
const INTERNAL_DND_TYPE = "application/x-cbreader-entries";
const TREE_VISIBLE_KEY = "cbreader:libraryTreeVisible";

interface Props {
  onOpenFile: (file: File) => void;
  refreshSignal: number;
}

interface MenuTarget {
  name: string;
  isDirectory: boolean;
}

type ContextMenuState =
  | { x: number; y: number; kind: "empty" }
  | { x: number; y: number; kind: "single"; target: MenuTarget }
  | { x: number; y: number; kind: "bulk" };

function parseKey(key: string): MoveItem {
  const isDirectory = key.startsWith("folder:");
  const name = key.slice(key.indexOf(":") + 1);
  return { name, isDirectory };
}

export default function Library({ onOpenFile, refreshSignal }: Props) {
  const [status, setStatus] = useState<Status>("checking");
  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [path, setPath] = useState<PathEntry[]>([]);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [comics, setComics] = useState<ComicEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [covers, setCovers] = useState<Map<string, string>>(new Map());
  const [coverErrors, setCoverErrors] = useState<Set<string>>(new Set());
  const [progressByName, setProgressByName] = useState<Map<string, ReaderProgress>>(new Map());
  const coversRef = useRef(covers);
  const sizeByNameRef = useRef<Map<string, number>>(new Map());

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<MenuTarget | null>(null);
  const [moveItems, setMoveItems] = useState<MoveItem[] | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [colorTarget, setColorTarget] = useState<string | null>(null);
  const [infoTarget, setInfoTarget] = useState<MenuTarget | null>(null);
  const [folderColors, setFolderColors] = useState<Record<string, string>>(() => loadFolderColors());
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ left: number; top: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [treeVisible, setTreeVisible] = useState(() => localStorage.getItem(TREE_VISIBLE_KEY) === "1");
  const [searchOpen, setSearchOpen] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null
  );
  const marqueeStartRef = useRef<{ x0: number; y0: number } | null>(null);
  const marqueeBaseSelectionRef = useRef<Set<string>>(new Set());
  const gridAreaRef = useRef<HTMLElement>(null);

  const currentHandle = path[path.length - 1]?.handle ?? null;
  const relativePathNames = path.slice(1).map((entry) => entry.name);
  const allKeys = useMemo(
    () => [...folders.map((f) => `folder:${f.name}`), ...comics.map((c) => `comic:${c.name}`)],
    [folders, comics]
  );

  useEffect(() => {
    coversRef.current = covers;
  }, [covers]);

  useEffect(() => {
    return () => {
      for (const url of coversRef.current.values()) URL.revokeObjectURL(url);
    };
  }, []);

  const refreshEntries = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setLoadingEntries(true);
    try {
      const { folders, comics } = await listEntries(handle);
      setFolders(folders);
      setComics(comics);
    } catch {
      setFolders([]);
      setComics([]);
      setPickError("Impossible de lire le contenu de ce dossier.");
    } finally {
      setLoadingEntries(false);
    }
  }, []);

  const navigateTo = useCallback(
    (nextPath: PathEntry[]) => {
      setPath(nextPath);
      setMenuFor(null);
      setContextMenu(null);
      setInfoTarget(null);
      setSelected(new Set());
      void refreshEntries(nextPath[nextPath.length - 1].handle);
    },
    [refreshEntries]
  );

  useEffect(() => {
    (async () => {
      if (!isFileSystemAccessSupported()) {
        setStatus("unsupported");
        return;
      }
      const handle = await loadDirectoryHandle();
      if (!handle) {
        setStatus("disconnected");
        return;
      }
      setRootHandle(handle);
      const permission = await queryPermission(handle);
      if (permission === "granted") {
        setStatus("connected");
        navigateTo([{ name: handle.name, handle }]);
      } else {
        setStatus("needs-permission");
      }
    })();
  }, [navigateTo]);

  useEffect(() => {
    setCovers((prev) => {
      for (const url of prev.values()) URL.revokeObjectURL(url);
      return new Map();
    });
    setCoverErrors(new Set());
    setProgressByName(new Map());
    sizeByNameRef.current = new Map();
    if (comics.length === 0) return;

    const cancelled = { current: false };
    const queue = [...comics];

    async function worker() {
      while (queue.length > 0 && !cancelled.current) {
        const entry = queue.shift();
        if (!entry) break;
        try {
          const file = await entry.handle.getFile();
          sizeByNameRef.current.set(entry.name, file.size);
          const progress = loadProgressByKey(entry.name, file.size);
          if (progress) setProgressByName((prev) => new Map(prev).set(entry.name, progress));

          const cover = await getCoverPage(file);
          if (cancelled.current) {
            if (cover) URL.revokeObjectURL(cover.url);
            return;
          }
          if (cover) {
            setCovers((prev) => new Map(prev).set(entry.name, cover.url));
          } else {
            setCoverErrors((prev) => new Set(prev).add(entry.name));
          }
        } catch {
          if (!cancelled.current) setCoverErrors((prev) => new Set(prev).add(entry.name));
        }
      }
    }

    void Promise.all(Array.from({ length: Math.min(COVER_CONCURRENCY, queue.length) }, worker));

    return () => {
      cancelled.current = true;
    };
  }, [comics]);

  // Reading a comic updates its saved progress in localStorage without touching
  // `comics` or the covers, so returning from the reader (refreshSignal changes)
  // just re-reads progress for the already-known file sizes — no re-fetching.
  useEffect(() => {
    if (sizeByNameRef.current.size === 0) return;
    setProgressByName((prev) => {
      const next = new Map(prev);
      for (const [name, size] of sizeByNameRef.current) {
        const progress = loadProgressByKey(name, size);
        if (progress) next.set(name, progress);
        else next.delete(name);
      }
      return next;
    });
  }, [refreshSignal]);

  useEffect(() => {
    if (!menuFor && !contextMenu && selected.size === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuFor(null);
      setContextMenu(null);
      setSelected(new Set());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuFor, contextMenu, selected.size]);

  // Clamps the context menu so right-clicking near a screen edge doesn't
  // render it partly off-viewport. Runs before paint so the correction is
  // never visible as a jump.
  useLayoutEffect(() => {
    if (!contextMenu) {
      setContextMenuPos(null);
      return;
    }
    const el = contextMenuRef.current;
    if (!el) {
      setContextMenuPos({ left: contextMenu.x, top: contextMenu.y });
      return;
    }
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 8;
    const maxTop = window.innerHeight - rect.height - 8;
    setContextMenuPos({
      left: Math.min(contextMenu.x, Math.max(8, maxLeft)),
      top: Math.min(contextMenu.y, Math.max(8, maxTop)),
    });
  }, [contextMenu]);

  // Marquee (rubber-band) selection: mousedown on empty grid background starts
  // it, live-updates `selected` to whatever cards the rectangle currently
  // intersects (unioned with whatever was already selected if a modifier key
  // was held at the start, so shift/ctrl-drag extends an existing selection).
  const updateSelectionForRect = useCallback((left: number, top: number, width: number, height: number) => {
    const container = gridAreaRef.current;
    if (!container) return;
    const right = left + width;
    const bottom = top + height;
    const next = new Set(marqueeBaseSelectionRef.current);
    container.querySelectorAll<HTMLElement>("[data-entry-key]").forEach((card) => {
      const r = card.getBoundingClientRect();
      if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) {
        next.add(card.dataset.entryKey as string);
      }
    });
    setSelected(next);
  }, []);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!marqueeStartRef.current) return;
      const { x0, y0 } = marqueeStartRef.current;
      const x1 = e.clientX;
      const y1 = e.clientY;
      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      const width = Math.abs(x1 - x0);
      const height = Math.abs(y1 - y0);
      setMarqueeRect({ left, top, width, height });
      updateSelectionForRect(left, top, width, height);
    }
    function onMouseUp() {
      marqueeStartRef.current = null;
      setMarqueeRect(null);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [updateSelectionForRect]);

  const handleGridMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || status !== "connected") return;
      const target = e.target as HTMLElement;
      if (
        target.closest(
          ".comic-card, button, .library__header, .library__selection-bar, .library-tree, .modal, .modal-overlay"
        )
      ) {
        return;
      }
      e.preventDefault();
      setMenuFor(null);
      setContextMenu(null);
      const extend = e.shiftKey || e.ctrlKey || e.metaKey;
      marqueeStartRef.current = { x0: e.clientX, y0: e.clientY };
      marqueeBaseSelectionRef.current = extend ? new Set(selected) : new Set();
      setMarqueeRect({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
      if (!extend) setSelected(new Set());
    },
    [selected, status]
  );

  const toggleSelected = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setLastSelectedKey(key);
  }, []);

  const selectRange = useCallback(
    (key: string) => {
      setSelected((prev) => {
        const anchor = lastSelectedKey ?? key;
        const i0 = allKeys.indexOf(anchor);
        const i1 = allKeys.indexOf(key);
        if (i0 === -1 || i1 === -1) return new Set(prev).add(key);
        const [lo, hi] = i0 < i1 ? [i0, i1] : [i1, i0];
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(allKeys[i]);
        return next;
      });
      setLastSelectedKey(key);
    },
    [allKeys, lastSelectedKey]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, key: string) => {
      const keys = selected.has(key) ? Array.from(selected) : [key];
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(INTERNAL_DND_TYPE, JSON.stringify(keys));
    },
    [selected]
  );

  const handlePickFolder = useCallback(async () => {
    setPickError(null);
    try {
      const handle = await pickLibraryFolder();
      setRootHandle(handle);
      setStatus("connected");
      navigateTo([{ name: handle.name, handle }]);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setPickError("Impossible d'accéder à ce dossier.");
    }
  }, [navigateTo]);

  const handleReconnect = useCallback(async () => {
    if (!rootHandle) return;
    setPickError(null);
    const permission = await requestPermission(rootHandle);
    if (permission === "granted") {
      setStatus("connected");
      navigateTo([{ name: rootHandle.name, handle: rootHandle }]);
    } else {
      setPickError("Accès au dossier refusé.");
    }
  }, [rootHandle, navigateTo]);

  const handleRefresh = useCallback(() => {
    if (currentHandle) void refreshEntries(currentHandle);
  }, [currentHandle, refreshEntries]);

  const toggleTree = useCallback(() => {
    setTreeVisible((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TREE_VISIBLE_KEY, next ? "1" : "0");
      } catch {
        // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
      }
      return next;
    });
  }, []);

  const openComic = useCallback(
    async (entry: ComicEntry) => {
      try {
        const file = await entry.handle.getFile();
        onOpenFile(file);
      } catch {
        setPickError(`Impossible d'ouvrir « ${entry.name} ».`);
      }
    },
    [onOpenFile]
  );

  const toggleMenu = useCallback((key: string) => {
    setContextMenu(null);
    setMenuFor((prev) => (prev === key ? null : key));
  }, []);

  const handleCardContextMenu = useCallback(
    (e: React.MouseEvent, key: string, target: MenuTarget) => {
      e.preventDefault();
      setMenuFor(null);
      if (selected.has(key) && selected.size > 1) {
        setContextMenu({ x: e.clientX, y: e.clientY, kind: "bulk" });
      } else {
        setContextMenu({ x: e.clientX, y: e.clientY, kind: "single", target });
      }
    },
    [selected]
  );

  const handleLibraryContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (status !== "connected" || !currentHandle) return;
      const target = e.target as HTMLElement;
      if (target.closest(".comic-card, .library__header, .library__selection-bar, .library-tree, .modal, .modal-overlay")) {
        return;
      }
      e.preventDefault();
      setMenuFor(null);
      setContextMenu({ x: e.clientX, y: e.clientY, kind: "empty" });
    },
    [status, currentHandle]
  );

  const startRename = useCallback((target: MenuTarget) => {
    setMenuFor(null);
    setModalError(null);
    setRenameTarget(target);
  }, []);

  const startMove = useCallback((target: MenuTarget) => {
    setMenuFor(null);
    setModalError(null);
    setMoveItems([target]);
  }, []);

  const startBulkMove = useCallback(() => {
    if (selected.size === 0) return;
    setModalError(null);
    setMoveItems(Array.from(selected).map(parseKey));
  }, [selected]);

  const startColor = useCallback((folderName: string) => {
    setMenuFor(null);
    setColorTarget(folderName);
  }, []);

  const startInfo = useCallback((target: MenuTarget) => {
    setMenuFor(null);
    setContextMenu(null);
    setInfoTarget(target);
  }, []);

  const handleColorSelect = useCallback(
    (color: string | null) => {
      if (colorTarget === null) return;
      const key = folderColorKey(relativePathNames, colorTarget);
      setFolderColors(saveFolderColor(key, color));
      setColorTarget(null);
    },
    [colorTarget, relativePathNames]
  );

  const handleFolderDragOver = useCallback((e: React.DragEvent, folderName: string) => {
    const isFiles = e.dataTransfer.types.includes("Files");
    const isInternal = e.dataTransfer.types.includes(INTERNAL_DND_TYPE);
    if (!isFiles && !isInternal) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isInternal ? "move" : "copy";
    setDragOverFolder(folderName);
  }, []);

  const handleFolderDragLeave = useCallback((folderName: string) => {
    setDragOverFolder((prev) => (prev === folderName ? null : prev));
  }, []);

  const handleFolderDrop = useCallback(
    async (e: React.DragEvent, folder: FolderEntry) => {
      e.preventDefault();
      setDragOverFolder(null);
      if (!currentHandle) return;

      const internalData = e.dataTransfer.getData(INTERNAL_DND_TYPE);
      if (internalData) {
        let keys: string[];
        try {
          keys = JSON.parse(internalData);
        } catch {
          return;
        }
        const items = keys.map(parseKey).filter((it) => !(it.isDirectory && it.name === folder.name));
        if (items.length === 0) return;
        setActionBusy(true);
        const errors: string[] = [];
        try {
          for (const item of items) {
            try {
              await moveEntry(currentHandle, item.name, folder.handle, item.isDirectory);
            } catch {
              errors.push(item.name);
            }
          }
          setSelected(new Set());
          await refreshEntries(currentHandle);
          if (errors.length > 0) setPickError(`Impossible de déplacer : ${errors.join(", ")}`);
        } finally {
          setActionBusy(false);
        }
        return;
      }

      const files = Array.from(e.dataTransfer.files).filter((file) => isComicFile(file.name));
      if (files.length === 0) {
        setPickError("Seuls les fichiers .cbz/.cbr peuvent être déposés dans un dossier.");
        return;
      }
      setActionBusy(true);
      try {
        for (const file of files) {
          try {
            await importFileIntoFolder(folder.handle, file);
          } catch (err) {
            setPickError(err instanceof Error ? err.message : `Impossible d'ajouter « ${file.name} ».`);
          }
        }
        await refreshEntries(currentHandle);
      } finally {
        setActionBusy(false);
      }
    },
    [currentHandle, refreshEntries]
  );

  // Native file-picker alternative to dragging a file in from the OS: adds
  // whatever's picked to the currently open folder.
  const handleImportFiles = useCallback(async () => {
    if (!currentHandle) return;
    let files: File[];
    try {
      files = await pickFilesToImport();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setPickError("Impossible de sélectionner des fichiers.");
      return;
    }
    const comicFiles = files.filter((file) => isComicFile(file.name));
    if (comicFiles.length === 0) {
      setPickError("Seuls les fichiers .cbz/.cbr peuvent être importés.");
      return;
    }
    setActionBusy(true);
    try {
      for (const file of comicFiles) {
        try {
          await importFileIntoFolder(currentHandle, file);
        } catch (err) {
          setPickError(err instanceof Error ? err.message : `Impossible d'ajouter « ${file.name} ».`);
        }
      }
      await refreshEntries(currentHandle);
    } finally {
      setActionBusy(false);
    }
  }, [currentHandle, refreshEntries]);

  const handleDelete = useCallback(
    async (target: MenuTarget) => {
      setMenuFor(null);
      const message = target.isDirectory
        ? `Supprimer le dossier « ${target.name} » ? Son contenu sera remonté dans le dossier actuel.`
        : `Supprimer « ${target.name} » ? Cette action est irréversible.`;
      if (!window.confirm(message)) return;
      if (!currentHandle) return;
      try {
        if (target.isDirectory) {
          const failed = await deleteFolder(currentHandle, target.name);
          if (failed.length > 0) {
            setPickError(`« ${target.name} » n'a pas pu être entièrement vidé (conflit de nom pour ${failed.join(", ")}) — le dossier n'a pas été supprimé.`);
          }
        } else {
          await deleteEntry(currentHandle, target.name, false);
        }
        await refreshEntries(currentHandle);
      } catch {
        setPickError(`Impossible de supprimer « ${target.name} ».`);
      }
    },
    [currentHandle, refreshEntries]
  );

  const handleBulkDelete = useCallback(async () => {
    if (!currentHandle || selected.size === 0) return;
    const items = Array.from(selected).map(parseKey);
    const label = `${items.length} élément${items.length > 1 ? "s" : ""}`;
    if (!window.confirm(`Supprimer ${label} ? Le contenu des dossiers supprimés sera remonté dans le dossier actuel.`)) {
      return;
    }
    setActionBusy(true);
    const errors: string[] = [];
    try {
      for (const item of items) {
        try {
          if (item.isDirectory) {
            const failed = await deleteFolder(currentHandle, item.name);
            if (failed.length > 0) errors.push(`${item.name} (conflit)`);
          } else {
            await deleteEntry(currentHandle, item.name, false);
          }
        } catch {
          errors.push(item.name);
        }
      }
      setSelected(new Set());
      await refreshEntries(currentHandle);
      if (errors.length > 0) setPickError(`Problème avec : ${errors.join(", ")}`);
    } finally {
      setActionBusy(false);
    }
  }, [currentHandle, selected, refreshEntries]);

  const handleCreateFolderSubmit = useCallback(
    async (name: string) => {
      if (!currentHandle) return;
      const validationError = validateEntryName(name);
      if (validationError) {
        setModalError(validationError);
        return;
      }
      setActionBusy(true);
      try {
        await createFolder(currentHandle, name.trim());
        setCreatingFolder(false);
        await refreshEntries(currentHandle);
      } catch (err) {
        setModalError(err instanceof Error ? err.message : "La création du dossier a échoué.");
      } finally {
        setActionBusy(false);
      }
    },
    [currentHandle, refreshEntries]
  );

  const handleRenameSubmit = useCallback(
    async (newName: string) => {
      if (!currentHandle || !renameTarget) return;
      const validationError = validateEntryName(newName);
      if (validationError) {
        setModalError(validationError);
        return;
      }
      const trimmed = newName.trim();
      setActionBusy(true);
      try {
        await renameEntry(currentHandle, renameTarget.name, trimmed, renameTarget.isDirectory);
        if (!renameTarget.isDirectory) {
          const size = sizeByNameRef.current.get(renameTarget.name);
          if (size !== undefined) renameProgressKey(renameTarget.name, trimmed, size);
        }
        setRenameTarget(null);
        await refreshEntries(currentHandle);
      } catch (err) {
        setModalError(err instanceof Error ? err.message : "Le renommage a échoué.");
      } finally {
        setActionBusy(false);
      }
    },
    [currentHandle, renameTarget, refreshEntries]
  );

  const handleMoveConfirm = useCallback(
    async (destination: FileSystemDirectoryHandle) => {
      if (!currentHandle || !moveItems) return;
      setActionBusy(true);
      try {
        if (moveItems.length === 1) {
          await moveEntry(currentHandle, moveItems[0].name, destination, moveItems[0].isDirectory);
          setMoveItems(null);
          setSelected(new Set());
          await refreshEntries(currentHandle);
          return;
        }
        const errors: string[] = [];
        for (const item of moveItems) {
          try {
            await moveEntry(currentHandle, item.name, destination, item.isDirectory);
          } catch {
            errors.push(item.name);
          }
        }
        setMoveItems(null);
        setSelected(new Set());
        await refreshEntries(currentHandle);
        if (errors.length > 0) setPickError(`Impossible de déplacer : ${errors.join(", ")}`);
      } catch (err) {
        setModalError(err instanceof Error ? err.message : "Le déplacement a échoué.");
      } finally {
        setActionBusy(false);
      }
    },
    [currentHandle, moveItems, refreshEntries]
  );

  return (
    <section
      className={`library ${marqueeRect ? "library--dragging" : ""}`}
      ref={gridAreaRef}
      onContextMenu={handleLibraryContextMenu}
      onMouseDown={handleGridMouseDown}
    >
      <div className="library__main">
      <div className="library__header">
        <h2>Bibliothèque</h2>
        {status === "connected" && path.length > 0 && (
          <div className="library__folder-controls">
            <span className="library__breadcrumb">
              📁{" "}
              {path.map((entry, i) => (
                <span key={i}>
                  {i > 0 && <span className="library__breadcrumb-sep">/</span>}
                  <button
                    type="button"
                    className="library__breadcrumb-crumb"
                    disabled={i === path.length - 1}
                    onClick={() => navigateTo(path.slice(0, i + 1))}
                  >
                    {entry.name}
                  </button>
                </span>
              ))}{" "}
              ({comics.length})
            </span>
            <button type="button" onClick={() => setCreatingFolder(true)}>
              Nouveau dossier
            </button>
            <button type="button" onClick={handleRefresh}>
              Actualiser
            </button>
            <button type="button" onClick={handlePickFolder}>
              Changer de dossier
            </button>
            <button type="button" className={treeVisible ? "active" : ""} onClick={toggleTree}>
              Arborescence
            </button>
            <button type="button" onClick={() => setSearchOpen(true)}>
              Rechercher
            </button>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="library__selection-bar">
          <span>
            {selected.size} élément{selected.size > 1 ? "s" : ""} sélectionné{selected.size > 1 ? "s" : ""}
          </span>
          <button type="button" onClick={startBulkMove} disabled={actionBusy}>
            Déplacer
          </button>
          <button type="button" className="entry-menu__danger" onClick={handleBulkDelete} disabled={actionBusy}>
            Supprimer
          </button>
          <button type="button" onClick={() => setSelected(new Set())}>
            Annuler
          </button>
        </div>
      )}

      {status === "unsupported" && (
        <p className="library__hint">
          La bibliothèque de dossier nécessite un navigateur basé sur Chromium (Chrome, Edge...). Vous pouvez toujours
          ouvrir un fichier individuellement avec le bouton ci-dessus.
        </p>
      )}

      {status === "disconnected" && (
        <div className="library__empty">
          <p>Connectez un dossier pour afficher tous vos comics d'un coup.</p>
          <button type="button" onClick={handlePickFolder}>
            Choisir un dossier de comics
          </button>
        </div>
      )}

      {status === "needs-permission" && rootHandle && (
        <div className="library__empty">
          <p>Le dossier « {rootHandle.name} » est mémorisé mais nécessite une confirmation d'accès.</p>
          <button type="button" onClick={handleReconnect}>
            Reconnecter le dossier
          </button>
          <button type="button" onClick={handlePickFolder}>
            Choisir un autre dossier
          </button>
        </div>
      )}

      {status === "connected" &&
        (loadingEntries ? (
          <p className="library__hint">Chargement du dossier…</p>
        ) : folders.length === 0 && comics.length === 0 ? (
          <p className="library__hint">Ce dossier est vide.</p>
        ) : (
          <div>
            {folders.length > 0 && (
              <div className="library__section">
                <h3 className="library__section-title">Dossiers</h3>
                <div className="library__grid library__grid--folders">
                  {folders.map((folder) => {
                    const key = `folder:${folder.name}`;
                    const color = folderColors[folderColorKey(relativePathNames, folder.name)];
                    const isSelected = selected.has(key);
                    return (
                      <div
                        key={key}
                        data-entry-key={key}
                        draggable
                        onDragStart={(e) => handleDragStart(e, key)}
                        className={`comic-card comic-card--folder ${isSelected ? "comic-card--selected" : ""} ${
                          dragOverFolder === folder.name ? "comic-card--drag-over" : ""
                        }`}
                        onDragOver={(e) => handleFolderDragOver(e, folder.name)}
                        onDragLeave={() => handleFolderDragLeave(folder.name)}
                        onDrop={(e) => handleFolderDrop(e, folder)}
                        onContextMenu={(e) => handleCardContextMenu(e, key, { name: folder.name, isDirectory: true })}
                      >
                        <button
                          type="button"
                          className="comic-card__open"
                          onClick={(e) => {
                            if (e.ctrlKey || e.metaKey) {
                              toggleSelected(key);
                              return;
                            }
                            if (e.shiftKey) {
                              selectRange(key);
                              return;
                            }
                            navigateTo([...path, folder]);
                          }}
                          title={folder.name}
                        >
                          <span className="folder-card__icon-wrap">
                            <FolderIcon color={color} className="comic-card__folder-icon" />
                          </span>
                          <span className="comic-card__name">{folder.name}</span>
                        </button>
                        <button
                          type="button"
                          className="comic-card__menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleMenu(key);
                          }}
                        >
                          ⋮
                        </button>
                        {menuFor === key && (
                          <div className="entry-menu">
                            <button type="button" onClick={() => startInfo({ name: folder.name, isDirectory: true })}>
                              Infos
                            </button>
                            <button type="button" onClick={() => startColor(folder.name)}>
                              Couleur
                            </button>
                            <button type="button" onClick={() => startRename({ name: folder.name, isDirectory: true })}>
                              Renommer
                            </button>
                            <button type="button" onClick={() => startMove({ name: folder.name, isDirectory: true })}>
                              Déplacer
                            </button>
                            <button
                              type="button"
                              className="entry-menu__danger"
                              onClick={() => handleDelete({ name: folder.name, isDirectory: true })}
                            >
                              Supprimer
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {comics.length > 0 && (
              <div className="library__section">
                <h3 className="library__section-title">Comics</h3>
                <div className="library__grid library__grid--comics">
                  {comics.map((entry) => {
                    const key = `comic:${entry.name}`;
                    const isSelected = selected.has(key);
                    const progress = progressByName.get(entry.name);
                    const percent =
                      progress && progress.pageCount > 0
                        ? Math.min(100, Math.round(((progress.pageIndex + 1) / progress.pageCount) * 100))
                        : null;
                    return (
                      <div
                        key={key}
                        data-entry-key={key}
                        draggable
                        onDragStart={(e) => handleDragStart(e, key)}
                        onContextMenu={(e) => handleCardContextMenu(e, key, { name: entry.name, isDirectory: false })}
                        className={`comic-card ${isSelected ? "comic-card--selected" : ""}`}
                      >
                        <button
                          type="button"
                          className="comic-card__open"
                          onClick={(e) => {
                            if (e.ctrlKey || e.metaKey) {
                              toggleSelected(key);
                              return;
                            }
                            if (e.shiftKey) {
                              selectRange(key);
                              return;
                            }
                            void openComic(entry);
                          }}
                          title={entry.name}
                        >
                          <span className="comic-card__cover">
                            {covers.has(entry.name) ? (
                              <img src={covers.get(entry.name)} alt="" loading="lazy" />
                            ) : coverErrors.has(entry.name) ? (
                              <span className="comic-card__fallback">📕</span>
                            ) : (
                              <span className="comic-card__loading" />
                            )}
                            {percent !== null && (
                              <span className="comic-card__progress" title={`${percent}% lu`}>
                                <span className="comic-card__progress-fill" style={{ width: `${percent}%` }} />
                              </span>
                            )}
                          </span>
                          <span className="comic-card__name">{entry.name}</span>
                        </button>
                        <button
                          type="button"
                          className="comic-card__menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleMenu(key);
                          }}
                        >
                          ⋮
                        </button>
                        {menuFor === key && (
                          <div className="entry-menu">
                            <button type="button" onClick={() => startInfo({ name: entry.name, isDirectory: false })}>
                              Infos
                            </button>
                            <button type="button" onClick={() => startRename({ name: entry.name, isDirectory: false })}>
                              Renommer
                            </button>
                            <button type="button" onClick={() => startMove({ name: entry.name, isDirectory: false })}>
                              Déplacer
                            </button>
                            <button
                              type="button"
                              className="entry-menu__danger"
                              onClick={() => handleDelete({ name: entry.name, isDirectory: false })}
                            >
                              Supprimer
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}

      {pickError && <p className="drop-zone__error">{pickError}</p>}
      </div>

      {treeVisible && rootHandle && status === "connected" && (
        <LibraryTree
          rootHandle={rootHandle}
          rootName={rootHandle.name}
          activePathKey={path.map((entry) => entry.name).join("/")}
          folderColors={folderColors}
          onNavigate={navigateTo}
          onOpenComic={openComic}
          onClose={toggleTree}
        />
      )}

      {menuFor && <div className="entry-menu-backdrop" onClick={() => setMenuFor(null)} />}

      {marqueeRect && (
        <div
          className="library__marquee"
          style={{ left: marqueeRect.left, top: marqueeRect.top, width: marqueeRect.width, height: marqueeRect.height }}
        />
      )}

      {contextMenu && (
        <>
          <div
            className="entry-menu-backdrop"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            ref={contextMenuRef}
            className="entry-menu entry-menu--context"
            style={contextMenuPos ?? { left: contextMenu.x, top: contextMenu.y }}
            onClick={() => setContextMenu(null)}
          >
            {contextMenu.kind === "empty" && (
              <>
                <button type="button" onClick={() => setCreatingFolder(true)}>
                  Nouveau dossier
                </button>
                <button type="button" onClick={() => void handleImportFiles()}>
                  Ajouter un fichier…
                </button>
              </>
            )}
            {contextMenu.kind === "single" && (
              <>
                <button type="button" onClick={() => startInfo(contextMenu.target)}>
                  Infos
                </button>
                {contextMenu.target.isDirectory && (
                  <button type="button" onClick={() => startColor(contextMenu.target.name)}>
                    Couleur
                  </button>
                )}
                <button type="button" onClick={() => startRename(contextMenu.target)}>
                  Renommer
                </button>
                <button type="button" onClick={() => startMove(contextMenu.target)}>
                  Déplacer
                </button>
                <button type="button" className="entry-menu__danger" onClick={() => handleDelete(contextMenu.target)}>
                  Supprimer
                </button>
              </>
            )}
            {contextMenu.kind === "bulk" && (
              <>
                <button type="button" onClick={startBulkMove}>
                  Déplacer {selected.size} éléments
                </button>
                <button type="button" className="entry-menu__danger" onClick={handleBulkDelete}>
                  Supprimer {selected.size} éléments
                </button>
              </>
            )}
          </div>
        </>
      )}

      {creatingFolder && (
        <PromptModal
          title="Nouveau dossier"
          label="Nom du dossier"
          confirmLabel="Créer"
          busy={actionBusy}
          error={modalError}
          onCancel={() => {
            setCreatingFolder(false);
            setModalError(null);
          }}
          onSubmit={handleCreateFolderSubmit}
        />
      )}

      {renameTarget && (
        <PromptModal
          title={renameTarget.isDirectory ? "Renommer le dossier" : "Renommer le fichier"}
          label="Nouveau nom"
          initialValue={renameTarget.name}
          confirmLabel="Renommer"
          busy={actionBusy}
          error={modalError}
          onCancel={() => {
            setRenameTarget(null);
            setModalError(null);
          }}
          onSubmit={handleRenameSubmit}
        />
      )}

      {moveItems && currentHandle && (
        <MoveFolderModal
          items={moveItems}
          initialPath={path}
          sourceParent={currentHandle}
          busy={actionBusy}
          error={modalError}
          onCancel={() => {
            setMoveItems(null);
            setModalError(null);
          }}
          onConfirm={handleMoveConfirm}
        />
      )}

      {colorTarget !== null && (
        <FolderColorModal
          folderName={colorTarget}
          currentColor={folderColors[folderColorKey(relativePathNames, colorTarget)] ?? null}
          onCancel={() => setColorTarget(null)}
          onSelect={handleColorSelect}
        />
      )}

      {infoTarget &&
        (() => {
          const entry = infoTarget.isDirectory
            ? folders.find((f) => f.name === infoTarget.name)
            : comics.find((c) => c.name === infoTarget.name);
          if (!entry) return null;
          return (
            <InfoModal
              name={infoTarget.name}
              isDirectory={infoTarget.isDirectory}
              handle={entry.handle}
              pathNames={[...path.map((entry) => entry.name), infoTarget.name]}
              onClose={() => setInfoTarget(null)}
            />
          );
        })()}

      {searchOpen && rootHandle && (
        <SearchModal
          rootHandle={rootHandle}
          rootName={rootHandle.name}
          onNavigateFolder={navigateTo}
          onOpenComic={openComic}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </section>
  );
}
