import { compareNatural } from "./naturalSort";

export interface ComicEntry {
  name: string;
  handle: FileSystemFileHandle;
}

export interface FolderEntry {
  name: string;
  handle: FileSystemDirectoryHandle;
}

export interface LibraryListing {
  folders: FolderEntry[];
  comics: ComicEntry[];
}

export interface PathEntry {
  name: string;
  handle: FileSystemDirectoryHandle;
}

export interface SearchResult {
  name: string;
  isDirectory: boolean;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  /** Root down to (but not including) this result. */
  parentPath: PathEntry[];
}

export type PermissionState = "granted" | "prompt" | "denied";

const COMIC_EXT_RE = /\.(cbz|cbr|zip|rar)$/i;
const INVALID_NAME_RE = /[<>:"/\\|?*\x00-\x1F]/;

const DB_NAME = "cbreader";
const DB_VERSION = 1;
const STORE_NAME = "library";
const HANDLE_KEY = "directoryHandle";

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export function isComicFile(name: string): boolean {
  return COMIC_EXT_RE.test(name);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = fn(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await withStore("readwrite", (store) => store.put(handle, HANDLE_KEY));
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await withStore<FileSystemDirectoryHandle | undefined>("readonly", (store) => store.get(HANDLE_KEY));
  return handle ?? null;
}

export async function clearDirectoryHandle(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(HANDLE_KEY));
}

export async function queryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return handle.queryPermission({ mode: "read" });
}

export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return handle.requestPermission({ mode: "read" });
}

export async function pickLibraryFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ id: "cbreader-library", mode: "read" });
  await saveDirectoryHandle(handle);
  return handle;
}

// Native file picker alternative to drag-and-drop for adding comics from
// anywhere on disk to the current library folder.
export async function pickFilesToImport(): Promise<File[]> {
  const handles = await window.showOpenFilePicker({
    id: "cbreader-import",
    multiple: true,
    types: [
      {
        description: "Comics",
        accept: { "application/octet-stream": [".cbz", ".cbr", ".zip", ".rar"] },
      },
    ],
  });
  const files: File[] = [];
  for (const handle of handles) {
    files.push(await handle.getFile());
  }
  return files;
}

export async function listEntries(handle: FileSystemDirectoryHandle): Promise<LibraryListing> {
  const folders: FolderEntry[] = [];
  const comics: ComicEntry[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "directory") {
      folders.push({ name: entry.name, handle: entry });
    } else if (COMIC_EXT_RE.test(entry.name)) {
      comics.push({ name: entry.name, handle: entry });
    }
  }
  folders.sort((a, b) => compareNatural(a.name, b.name));
  comics.sort((a, b) => compareNatural(a.name, b.name));
  return { folders, comics };
}

// Recursively walks the whole connected library looking for name matches.
// Only ever runs on demand (the user actively searching), never on load —
// everywhere else in this library intentionally avoids eagerly walking the
// full tree to stay fast on large collections, and this is the one place
// that genuinely needs to. `isCancelled` lets the caller abandon an
// in-flight search (e.g. the query changed) without waiting for it to
// finish walking whatever's left.
export async function searchLibrary(
  rootHandle: FileSystemDirectoryHandle,
  rootName: string,
  query: string,
  isCancelled: () => boolean
): Promise<SearchResult[]> {
  const normalized = query.trim().toLowerCase();
  const results: SearchResult[] = [];
  if (!normalized) return results;

  async function walk(handle: FileSystemDirectoryHandle, parentPath: PathEntry[]): Promise<void> {
    if (isCancelled()) return;
    const { folders, comics } = await listEntries(handle);
    for (const folder of folders) {
      if (isCancelled()) return;
      if (folder.name.toLowerCase().includes(normalized)) {
        results.push({ name: folder.name, isDirectory: true, handle: folder.handle, parentPath });
      }
      await walk(folder.handle, [...parentPath, folder]);
    }
    for (const comic of comics) {
      if (isCancelled()) return;
      if (comic.name.toLowerCase().includes(normalized)) {
        results.push({ name: comic.name, isDirectory: false, handle: comic.handle, parentPath });
      }
    }
  }

  await walk(rootHandle, [{ name: rootName, handle: rootHandle }]);
  return results;
}

export function validateEntryName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Le nom ne peut pas être vide.";
  if (trimmed === "." || trimmed === "..") return "Ce nom n'est pas valide.";
  if (INVALID_NAME_RE.test(trimmed)) return 'Le nom ne peut pas contenir : < > : " / \\ | ? *';
  return null;
}

async function entryKindIfExists(parent: FileSystemDirectoryHandle, name: string): Promise<FileSystemHandleKind | null> {
  for await (const entry of parent.values()) {
    if (entry.name === name) return entry.kind;
  }
  return null;
}

// Writes file content via a stream instead of reading it fully into memory —
// required so renaming/moving/importing a multi-gigabyte comic doesn't blow
// the memory ceiling the lazy-loading archive reader was built to avoid.
async function writeFileStreamed(file: File, destParent: FileSystemDirectoryHandle, destName: string): Promise<void> {
  const destHandle = await destParent.getFileHandle(destName, { create: true });
  const writable = await destHandle.createWritable();
  await file.stream().pipeTo(writable);
}

async function copyFileStreamed(
  source: FileSystemFileHandle,
  destParent: FileSystemDirectoryHandle,
  destName: string
): Promise<void> {
  await writeFileStreamed(await source.getFile(), destParent, destName);
}

// Imports a file dropped in from outside the library (e.g. dragged from the
// OS's Downloads folder) by copying its bytes into destParent. This is
// always a copy, never a move: drag-and-drop only ever grants read access to
// the dropped file, so the source can't be deleted afterwards even if it
// came from a real filesystem location.
export async function importFileIntoFolder(destParent: FileSystemDirectoryHandle, file: File): Promise<void> {
  if (await entryKindIfExists(destParent, file.name)) {
    throw new Error(`« ${file.name} » existe déjà dans ce dossier.`);
  }
  await writeFileStreamed(file, destParent, file.name);
}

async function copyDirectoryRecursive(
  source: FileSystemDirectoryHandle,
  destParent: FileSystemDirectoryHandle,
  destName: string
): Promise<void> {
  const destHandle = await destParent.getDirectoryHandle(destName, { create: true });
  for await (const entry of source.values()) {
    if (entry.kind === "file") {
      await copyFileStreamed(entry, destHandle, entry.name);
    } else {
      await copyDirectoryRecursive(entry, destHandle, entry.name);
    }
  }
}

// FileSystemHandle.move() is a newer addition to the File System Access API
// (not yet in @types/wicg-file-system-access — declared in vite-env.d.ts)
// that renames/moves an entry natively, in place, with no data copy. Used
// when available; the streamed copy+delete above is the fallback.
function moveCapable(handle: FileSystemHandle): handle is FileSystemHandle & {
  move(newParentOrName: FileSystemDirectoryHandle | string, newName?: string): Promise<void>;
} {
  return typeof (handle as { move?: unknown }).move === "function";
}

async function tryNativeMove(
  handle: FileSystemHandle,
  destParent: FileSystemDirectoryHandle | null,
  newName: string | null
): Promise<boolean> {
  if (!moveCapable(handle)) return false;
  if (destParent && newName) await handle.move(destParent, newName);
  else if (destParent) await handle.move(destParent);
  else if (newName) await handle.move(newName);
  return true;
}

export async function createFolder(parent: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> {
  const trimmed = name.trim();
  if (await entryKindIfExists(parent, trimmed)) {
    throw new Error(`« ${trimmed} » existe déjà dans ce dossier.`);
  }
  return parent.getDirectoryHandle(trimmed, { create: true });
}

export async function deleteEntry(parent: FileSystemDirectoryHandle, name: string, isDirectory: boolean): Promise<void> {
  await parent.removeEntry(name, { recursive: isDirectory });
}

// Deleting a folder doesn't destroy its contents: every direct child (file or
// subfolder) is promoted up into `parent` first, and the now-empty folder is
// removed last. If a child's name collides with something already in
// `parent`, that one child is left behind (reported in the returned list)
// and the folder itself is NOT removed, so nothing is silently lost.
export async function deleteFolder(parent: FileSystemDirectoryHandle, name: string): Promise<string[]> {
  const folderHandle = await parent.getDirectoryHandle(name);
  const children: { name: string; isDirectory: boolean }[] = [];
  for await (const entry of folderHandle.values()) {
    children.push({ name: entry.name, isDirectory: entry.kind === "directory" });
  }

  const failed: string[] = [];
  for (const child of children) {
    try {
      await moveEntry(folderHandle, child.name, parent, child.isDirectory);
    } catch {
      failed.push(child.name);
    }
  }

  if (failed.length === 0) {
    await parent.removeEntry(name, { recursive: false });
  }
  return failed;
}

export async function renameEntry(
  parent: FileSystemDirectoryHandle,
  oldName: string,
  newName: string,
  isDirectory: boolean
): Promise<void> {
  const trimmed = newName.trim();
  if (trimmed === oldName) return;
  if (await entryKindIfExists(parent, trimmed)) {
    throw new Error(`« ${trimmed} » existe déjà dans ce dossier.`);
  }
  const handle = isDirectory ? await parent.getDirectoryHandle(oldName) : await parent.getFileHandle(oldName);
  if (await tryNativeMove(handle, null, trimmed)) return;
  if (isDirectory) {
    await copyDirectoryRecursive(handle as FileSystemDirectoryHandle, parent, trimmed);
  } else {
    await copyFileStreamed(handle as FileSystemFileHandle, parent, trimmed);
  }
  await parent.removeEntry(oldName, { recursive: isDirectory });
}

export async function moveEntry(
  sourceParent: FileSystemDirectoryHandle,
  name: string,
  destParent: FileSystemDirectoryHandle,
  isDirectory: boolean
): Promise<void> {
  if (await sourceParent.isSameEntry(destParent)) return;
  if (await entryKindIfExists(destParent, name)) {
    throw new Error(`« ${name} » existe déjà dans le dossier de destination.`);
  }
  const handle = isDirectory ? await sourceParent.getDirectoryHandle(name) : await sourceParent.getFileHandle(name);
  if (await tryNativeMove(handle, destParent, null)) return;
  if (isDirectory) {
    await copyDirectoryRecursive(handle as FileSystemDirectoryHandle, destParent, name);
  } else {
    await copyFileStreamed(handle as FileSystemFileHandle, destParent, name);
  }
  await sourceParent.removeEntry(name, { recursive: isDirectory });
}
