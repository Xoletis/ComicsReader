import { inflateSync, unzipSync } from "fflate";
import { createExtractorFromData, type FileHeader } from "node-unrar-js";
import unrarWasmUrl from "node-unrar-js/esm/js/unrar.wasm?url";
import { compareNatural } from "./naturalSort";

export type ArchiveFormat = "cbz" | "cbr";

export interface Page {
  name: string;
  url: string;
}

export interface OpenedArchive {
  format: ArchiveFormat;
  pageCount: number;
  /** Synchronous cache lookup — never triggers extraction. */
  peekPage(index: number): Page | undefined;
  /** Extracts (or returns from cache) a single page. */
  getPage(index: number): Promise<Page>;
  /** Frees cached pages outside [keepMin, keepMax] to bound memory usage. */
  evictOutside(keepMin: number, keepMax: number): void;
  dispose(): void;
}

// A real File already satisfies this (and is what drag-and-drop and the
// library provide), but it's kept narrow so a comic opened from the OS
// (see lib/desktopOpen.ts) can be backed by lazy Range-fetches instead of a
// File constructed from an eagerly-downloaded buffer — the whole point being
// to avoid ever holding more than one full copy of a multi-gigabyte comic in
// memory at once.
export interface ArchiveSourceSlice {
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface ArchiveSource {
  readonly name: string;
  readonly size: number;
  slice(start?: number, end?: number): ArchiveSourceSlice;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const IGNORED_PATH_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/i;

export class UnsupportedFormatError extends Error {}

export function detectFormat(file: ArchiveSource): ArchiveFormat | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".cbz") || name.endsWith(".zip")) return "cbz";
  if (name.endsWith(".cbr") || name.endsWith(".rar")) return "cbr";
  return null;
}

const ZIP_MAGIC = [0x50, 0x4b];
const RAR_MAGIC = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07];

function bytesStartWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte);
}

// The actual bytes are the source of truth: comic files are routinely mislabeled
// (e.g. a RAR archive renamed to .cbz), which would otherwise fail silently since
// the wrong extractor is picked based on the extension alone.
async function detectFormatFromContent(file: ArchiveSource): Promise<ArchiveFormat | null> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (bytesStartWith(head, ZIP_MAGIC)) return "cbz";
  if (bytesStartWith(head, RAR_MAGIC)) return "cbr";
  return null;
}

async function resolveFormat(file: ArchiveSource): Promise<ArchiveFormat | null> {
  return (await detectFormatFromContent(file)) ?? detectFormat(file);
}

export async function openArchive(file: ArchiveSource): Promise<OpenedArchive> {
  const format = await resolveFormat(file);
  if (format !== "cbz" && format !== "cbr") {
    throw new UnsupportedFormatError("Format de fichier non reconnu. Utilisez un fichier .cbz, .cbr, .zip ou .rar.");
  }

  const buffer = await file.arrayBuffer();
  const names = format === "cbz" ? collectCbzImageNames(buffer) : await collectCbrImageNames(buffer);

  if (names.length === 0) {
    throw new UnsupportedFormatError("Aucune image trouvée dans cette archive.");
  }

  const cache = new Map<number, Page>();
  const pending = new Map<number, Promise<Page>>();

  async function extractIndex(index: number): Promise<Page> {
    const name = names[index];
    const image = format === "cbz" ? extractCbzSingle(buffer, name) : await extractCbrSingle(buffer, name);
    if (!image) {
      throw new UnsupportedFormatError(`Impossible d'extraire la page "${name}".`);
    }
    return toPage(image.name, image.data);
  }

  return {
    format,
    pageCount: names.length,

    peekPage(index) {
      return cache.get(index);
    },

    async getPage(index) {
      const cached = cache.get(index);
      if (cached) return cached;
      const inFlight = pending.get(index);
      if (inFlight) return inFlight;

      const promise = extractIndex(index)
        .then((page) => {
          cache.set(index, page);
          return page;
        })
        .finally(() => pending.delete(index));
      pending.set(index, promise);
      return promise;
    },

    evictOutside(keepMin, keepMax) {
      for (const index of [...cache.keys()]) {
        if (index < keepMin || index > keepMax) {
          URL.revokeObjectURL(cache.get(index)!.url);
          cache.delete(index);
        }
      }
    },

    dispose() {
      for (const page of cache.values()) URL.revokeObjectURL(page.url);
      cache.clear();
      pending.clear();
    },
  };
}

export async function getCoverPage(file: ArchiveSource): Promise<Page | null> {
  const format = await resolveFormat(file);
  if (format !== "cbz" && format !== "cbr") return null;

  const image = format === "cbz" ? await getCbzCoverFast(file) : await getCbrCoverFast(file);
  return image ? toPage(image.name, image.data) : null;
}

interface ExtractedImage {
  name: string;
  data: Uint8Array;
}

function isImageEntry(name: string): boolean {
  return IMAGE_EXT_RE.test(name) && !IGNORED_PATH_RE.test(name);
}

function toPage(name: string, data: Uint8Array): Page {
  const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeFromName(name) });
  return { name, url: URL.createObjectURL(blob) };
}

function collectCbzImageNames(buffer: ArrayBuffer): string[] {
  const names: string[] = [];
  unzipSync(new Uint8Array(buffer), {
    filter(entry) {
      if (!entry.name.endsWith("/") && isImageEntry(entry.name)) names.push(entry.name);
      return false;
    },
  });
  return names.sort(compareNatural);
}

function extractCbzSingle(buffer: ArrayBuffer, name: string): ExtractedImage | null {
  const entries = unzipSync(new Uint8Array(buffer), { filter: (entry) => entry.name === name });
  const data = entries[name];
  return data ? { name, data } : null;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MAX_TAIL = 65557; // 22-byte EOCD record + max 65535-byte archive comment

interface ZipCentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

// Unlike RAR's sequential layout, ZIP keeps its directory of entries at the very
// end of the file, so a partial read has to start from the tail. This reads only
// the EOCD record, the central directory, and the one target entry's local header
// + compressed bytes — never the whole (potentially huge) archive.
async function getCbzCoverFast(file: ArchiveSource): Promise<ExtractedImage | null> {
  try {
    const entries = await readZipCentralDirectory(file);
    const coverName = entries
      .map((e) => e.name)
      .filter((name) => !name.endsWith("/") && isImageEntry(name))
      .sort(compareNatural)[0];
    if (!coverName) return null;
    const entry = entries.find((e) => e.name === coverName);
    const image = entry && (await readZipEntryData(file, entry));
    if (image) return image;
  } catch {
    // Unusual layout (e.g. ZIP64, encrypted entries) — fall back to a full read below.
  }

  const buffer = await file.arrayBuffer();
  const names = collectCbzImageNames(buffer);
  if (names.length === 0) return null;
  return extractCbzSingle(buffer, names[0]);
}

async function readZipCentralDirectory(file: ArchiveSource): Promise<ZipCentralEntry[]> {
  const tailSize = Math.min(file.size, EOCD_MAX_TAIL);
  const tail = new Uint8Array(await file.slice(file.size - tailSize, file.size).arrayBuffer());
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  let eocdOffset = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("EOCD record not found");

  const cdSize = tailView.getUint32(eocdOffset + 12, true);
  const cdOffset = tailView.getUint32(eocdOffset + 16, true);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported by the fast cover path");
  }

  const cdBytes = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const cdView = new DataView(cdBytes.buffer, cdBytes.byteOffset, cdBytes.byteLength);
  const decoder = new TextDecoder();

  const entries: ZipCentralEntry[] = [];
  let pos = 0;
  while (pos + 46 <= cdBytes.length && cdView.getUint32(pos, true) === CENTRAL_DIRECTORY_SIGNATURE) {
    const method = cdView.getUint16(pos + 10, true);
    const compressedSize = cdView.getUint32(pos + 20, true);
    const nameLen = cdView.getUint16(pos + 28, true);
    const extraLen = cdView.getUint16(pos + 30, true);
    const commentLen = cdView.getUint16(pos + 32, true);
    const localHeaderOffset = cdView.getUint32(pos + 42, true);
    const name = decoder.decode(cdBytes.subarray(pos + 46, pos + 46 + nameLen));
    entries.push({ name, method, compressedSize, localHeaderOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readZipEntryData(file: ArchiveSource, entry: ZipCentralEntry): Promise<ExtractedImage | null> {
  // The local header repeats the name/extra fields, sometimes with different
  // lengths than the central directory record, so its own lengths must be read.
  const head = new Uint8Array(await file.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer());
  const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (headView.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) return null;
  const nameLen = headView.getUint16(26, true);
  const extraLen = headView.getUint16(28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;

  const compressed = new Uint8Array(await file.slice(dataStart, dataStart + entry.compressedSize).arrayBuffer());
  if (entry.method === 0) return { name: entry.name, data: compressed };
  if (entry.method === 8) return { name: entry.name, data: inflateSync(compressed) };
  return null; // Unsupported compression method for the fast path (fallback handles it).
}

let wasmBinaryPromise: Promise<ArrayBuffer> | null = null;

function loadWasmBinary(): Promise<ArrayBuffer> {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = fetch(unrarWasmUrl)
      .then((res) => res.arrayBuffer())
      .catch((err) => {
        wasmBinaryPromise = null;
        throw err;
      });
  }
  return wasmBinaryPromise;
}

// node-unrar-js's ExtractorData keeps every extracted file's bytes in an internal
// map for the lifetime of the Extractor instance and never frees them. Reusing one
// extractor across many pages would leak the whole comic into memory over a reading
// session, exactly the problem this lazy loader exists to avoid — so a fresh,
// short-lived extractor is created for every single-page/listing request instead.
async function openCbrExtractor(buffer: ArrayBuffer) {
  const wasmBinary = await loadWasmBinary();
  try {
    return await createExtractorFromData({ wasmBinary, data: buffer });
  } catch {
    throw new UnsupportedFormatError("Impossible de lire cette archive RAR (fichier corrompu ou format non supporté).");
  }
}

async function collectCbrImageNames(buffer: ArrayBuffer): Promise<string[]> {
  const extractor = await openCbrExtractor(buffer);
  const names: string[] = [];
  const { fileHeaders } = extractor.getFileList();
  for (const header of fileHeaders) {
    if (!header.flags.directory && isImageEntry(header.name)) names.push(header.name);
  }
  return names.sort(compareNatural);
}

async function extractCbrSingle(buffer: ArrayBuffer, name: string): Promise<ExtractedImage | null> {
  const extractor = await openCbrExtractor(buffer);

  let result: ExtractedImage | null = null;
  try {
    const { files } = extractor.extract({ files: [name] });
    // Iterated to natural completion (never broken out of early): the generator only
    // runs its internal cleanup (closing the archive handle) once it is fully drained.
    for (const { fileHeader, extraction } of files) {
      if (extraction) result = { name: fileHeader.name, data: extraction };
    }
  } catch (err) {
    if (err instanceof Error && /password/i.test(err.message)) {
      throw new UnsupportedFormatError("Cette archive RAR est protégée par mot de passe, ce n'est pas pris en charge.");
    }
    return null;
  }
  return result;
}

const COVER_PREFIX_START = 8 * 1024 * 1024; // 8MB — comfortably fits at least the first page
const COVER_PREFIX_GROWTH = 6;
const COVER_PREFIX_MAX_TRIES = 5; // 8, 48, 288 MB, ... then the whole file

// Extracts every image entry that is fully contained within a (possibly truncated)
// prefix buffer in a single extractor pass, instead of listing then extracting
// separately. Hitting the truncation boundary throws a clean, catchable error —
// verified against node-unrar-js — so whatever was already extracted before that
// point is simply kept.
async function extractCbrLeadingImages(buffer: ArrayBuffer): Promise<ExtractedImage[]> {
  let extractor;
  try {
    extractor = await openCbrExtractor(buffer);
  } catch {
    return [];
  }
  const isImageHeader = (fileHeader: FileHeader) => !fileHeader.flags.directory && isImageEntry(fileHeader.name);
  const images: ExtractedImage[] = [];
  try {
    const { files } = extractor.extract({ files: isImageHeader });
    for (const { fileHeader, extraction } of files) {
      if (extraction) images.push({ name: fileHeader.name, data: extraction });
    }
  } catch {
    // Truncated prefix: keep whatever was fully extracted before the read error.
  }
  return images;
}

// RAR stores entries sequentially (each file's header immediately precedes its
// data), unlike ZIP's end-of-file central directory — so for the very common case
// of a well-formed archive, the cover only requires reading a small prefix of the
// file instead of the whole thing, however large it is. Each attempt only needs to
// fully contain the *first* page in natural sort order, not the whole archive, so
// a failed/truncated attempt just means "grow the prefix and try again", with a
// full-file read as the final, always-correct fallback.
async function getCbrCoverFast(file: ArchiveSource): Promise<ExtractedImage | null> {
  let prefixSize = Math.min(COVER_PREFIX_START, file.size);
  for (let attempt = 0; attempt < COVER_PREFIX_MAX_TRIES; attempt++) {
    const isFullFile = prefixSize >= file.size;
    const buffer = await file.slice(0, prefixSize).arrayBuffer();
    const images = await extractCbrLeadingImages(buffer);
    if (images.length > 0) {
      return images.sort((a, b) => compareNatural(a.name, b.name))[0];
    }
    if (isFullFile) return null;
    prefixSize = Math.min(prefixSize * COVER_PREFIX_GROWTH, file.size);
  }

  const buffer = await file.arrayBuffer();
  const names = await collectCbrImageNames(buffer);
  if (names.length === 0) return null;
  return extractCbrSingle(buffer, names[0]);
}

function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}
