// The Android equivalent of lib/library.ts's "web" backend (File System
// Access API). Android's WebView has no showDirectoryPicker at all, and
// neither official Tauri plugin (plugin-dialog, plugin-fs) supports picking
// or listing a folder there as of writing — see the third-party
// tauri-plugin-android-fs this wraps. Deliberately a separate module with
// its own types (FsUri, not FileSystemDirectoryHandle) rather than trying to
// force both backends through one shared shape: the underlying models are
// different enough (opaque URIs vs. real handles, no native move/rename,
// flat non-recursive listing) that a shared interface would be a fiction.
//
// Scope: browse and read only (pick root, navigate subfolders, list comics,
// open one). No create/rename/move/delete/drag-and-drop/search on Android —
// see the plan this was built from for why. Library.tsx hides the UI for
// those entirely on Android rather than wiring them here.
import { isTauri } from "@tauri-apps/api/core";
import * as AndroidFs from "tauri-plugin-android-fs-api";
import { withStore } from "./db";
import { compareNatural } from "./naturalSort";
import { COMIC_EXT_RE, type PermissionState } from "./library";

export type { FsUri } from "tauri-plugin-android-fs-api";

export interface AndroidFolderEntry {
  name: string;
  uri: AndroidFs.FsUri;
}

export interface AndroidComicEntry {
  name: string;
  uri: AndroidFs.FsUri;
}

export interface AndroidLibraryListing {
  folders: AndroidFolderEntry[];
  comics: AndroidComicEntry[];
}

export interface AndroidRoot {
  name: string;
  uri: AndroidFs.FsUri;
}

const HANDLE_KEY = "androidDirectoryHandle";

// Despite its synchronous, no-args signature, AndroidFs.isAndroid() actually
// reaches into Tauri's native bridge — confirmed by direct testing, not
// assumption: it throws outright ("...may be not set up") in any context
// without a Tauri runtime at all (the plain web build, or this component
// mounted in a dev browser tab), which crashed the whole Library component
// before this guard existed. isTauri() short-circuits that case, and the
// try/catch covers the desktop Tauri build too, where this plugin is never
// registered (Cargo.toml gates it to target_os = "android" only).
export function isAndroidFsSupported(): boolean {
  if (!isTauri()) return false;
  try {
    return AndroidFs.isAndroid();
  } catch {
    return false;
  }
}

export async function saveDirectoryHandleAndroid(uri: AndroidFs.FsUri): Promise<void> {
  await withStore("readwrite", (store) => store.put(uri, HANDLE_KEY));
}

export async function loadDirectoryHandleAndroid(): Promise<AndroidFs.FsUri | null> {
  const uri = await withStore<AndroidFs.FsUri | undefined>("readonly", (store) => store.get(HANDLE_KEY));
  return uri ?? null;
}

export async function clearDirectoryHandleAndroid(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(HANDLE_KEY));
}

// Opens the system folder picker (Storage Access Framework) and persists
// permission to it across app restarts — the Android analogue of
// pickLibraryFolder() + saveDirectoryHandle() combined in lib/library.ts.
export async function pickLibraryFolderAndroid(): Promise<AndroidRoot> {
  const uri = await AndroidFs.showOpenDirPicker();
  if (!uri) throw new Error("Aucun dossier sélectionné.");
  await AndroidFs.persistPickerUriPermission(uri);
  await saveDirectoryHandleAndroid(uri);
  const name = await AndroidFs.getName(uri);
  return { name, uri };
}

// No silent re-prompt exists for a previously-picked URI whose permission
// was revoked — SAF's only way back is picking again, so "reconnect" on
// Android is the same flow as picking fresh.
export const requestPermissionAndroid = pickLibraryFolderAndroid;

export async function checkPermissionAndroid(uri: AndroidFs.FsUri): Promise<PermissionState> {
  const granted = await AndroidFs.checkPersistedPickerUriPermission(uri, "Read");
  return granted ? "granted" : "denied";
}

export async function getEntryNameAndroid(uri: AndroidFs.FsUri): Promise<string> {
  return AndroidFs.getName(uri);
}

// readDir() lists exactly one level (no recursion), matching how
// listEntries() in lib/library.ts walks handle.values() — same shape,
// different source.
export async function listEntriesAndroid(uri: AndroidFs.FsUri): Promise<AndroidLibraryListing> {
  const entries = await AndroidFs.readDir(uri);
  const folders: AndroidFolderEntry[] = [];
  const comics: AndroidComicEntry[] = [];
  for (const entry of entries) {
    if (entry.type === "Dir") {
      folders.push({ name: entry.name, uri: entry.uri });
    } else if (COMIC_EXT_RE.test(entry.name)) {
      comics.push({ name: entry.name, uri: entry.uri });
    }
  }
  folders.sort((a, b) => compareNatural(a.name, b.name));
  comics.sort((a, b) => compareNatural(a.name, b.name));
  return { folders, comics };
}

// Reads the whole file into memory and wraps it as a plain File — which
// already satisfies ArchiveSource (lib/archive.ts) as-is, exactly like a
// drag-and-dropped File does today. No streaming/range-read equivalent to
// desktop's lazy RemoteArchiveSource (lib/desktopOpen.ts): the plugin only
// exposes whole-file reads, so a very large comic is fully buffered before
// it can be opened — same memory profile as the existing drag-and-drop path,
// not a new regression.
export async function openComicFileAndroid(uri: AndroidFs.FsUri, name: string): Promise<File> {
  const [bytes, metadata] = await Promise.all([AndroidFs.readFile(uri), AndroidFs.getMetadata(uri)]);
  // A real lastModified matters here, not just cosmetically — the cover
  // cache (lib/coverCache.ts) and reading-progress keys (lib/progress.ts)
  // are both invalidated by it, so a fabricated "now" timestamp would make
  // every reopen look like a different, uncached file.
  const lastModified = metadata.type === "File" ? metadata.lastModified.getTime() : Date.now();
  return new File([bytes], name, { lastModified });
}
