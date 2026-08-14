import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArchiveSource, ArchiveSourceSlice } from "./archive";

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

// A single unranged (or one very large) fetch against Tauri's asset protocol
// makes it buffer the *entire* response before the renderer sees any of it —
// confirmed by direct testing: a plain whole-file GET on a ~1.6GB comic never
// resolved at all before the process was killed (OOM), which is exactly the
// crash the old read_file_bytes/IPC path had, just moved into Tauri's own
// protocol handler instead of our command. Bounded Range requests avoid that.
//
// A single Range response is also capped well below what's requested (~1MB,
// confirmed by direct testing, regardless of asking for 32MB) without an
// error or a truncated Content-Range — so the read loop below always advances
// by the number of bytes actually received, never by the requested size.
const CHUNK_SIZE = 32 * 1024 * 1024; // 32MB per request (the effective cap is smaller; this is just an upper bound)

// Backed by Tauri's asset protocol (the same streamed-resource machinery as
// an <img src>, not an invoke() IPC call) instead of a File eagerly built
// from a downloaded buffer, and always read in bounded chunks rather than
// one large or unranged request. This class only ever reads a byte range
// when something actually asks for it via .slice() / .arrayBuffer(), the
// same lazy, on-demand shape a real drag-and-dropped File already has —
// which is why drag-and-drop was never affected by any of this.
class RemoteArchiveSource implements ArchiveSource {
  constructor(
    private readonly url: string,
    readonly name: string,
    readonly size: number,
    readonly path: string
  ) {}

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.rangedArrayBuffer(0, this.size);
  }

  slice(start = 0, end = this.size): ArchiveSourceSlice {
    return { arrayBuffer: () => this.rangedArrayBuffer(start, end) };
  }

  private async fetchRange(start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
    const response = await fetch(this.url, { headers: { Range: `bytes=${start}-${end - 1}` } });
    if (!response.ok) throw new Error(`Échec de lecture de "${this.name}" (HTTP ${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async rangedArrayBuffer(start: number, end: number): Promise<ArrayBuffer> {
    const clampedEnd = Math.min(end, this.size);
    if (clampedEnd <= start) return new ArrayBuffer(0);

    const result = new Uint8Array(clampedEnd - start);
    let offset = 0;
    while (start + offset < clampedEnd) {
      const chunk = await this.fetchRange(start + offset, Math.min(start + offset + CHUNK_SIZE, clampedEnd));
      if (chunk.byteLength === 0) {
        throw new Error(`Lecture interrompue en lisant "${this.name}" (le serveur a renvoyé 0 octet).`);
      }
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  }
}

// The comic's byte size is needed up front for the progress-storage key
// (lib/progress.ts), so it's read via a 1-byte Range request rather than a
// HEAD request — Tauri's asset protocol is confirmed to support Range (it's
// what makes RemoteArchiveSource's own .slice() work), HEAD support is not.
async function fetchSize(url: string): Promise<number> {
  const response = await fetch(url, { headers: { Range: "bytes=0-0" } });
  if (!response.ok) throw new Error(`Échec de lecture de la taille du fichier (HTTP ${response.status}).`);
  const contentRange = response.headers.get("content-range"); // "bytes 0-0/12345"
  const total = contentRange && /\/(\d+)$/.exec(contentRange)?.[1];
  if (!total) throw new Error("Taille de fichier introuvable (en-tête Content-Range absent).");
  return parseInt(total, 10);
}

export async function pathToSource(path: string): Promise<ArchiveSource> {
  const url = convertFileSrc(path);
  const size = await fetchSize(url);
  return new RemoteArchiveSource(url, basename(path), size, path);
}

// Module-level and never reset: the one-shot "was a file waiting at startup?"
// check must run at most once for the whole page lifetime. Confirmed by
// direct testing (not just theory) that React 18 StrictMode's mount →
// cleanup → mount-again dance runs for this app's production build — App.tsx's
// effect that calls watchDesktopFileOpen() fires twice, with a real cleanup
// call in between. A guard that resets on cleanup (as an earlier version of
// this fix did) gets reset by that first cleanup and still fires the check
// twice. This one doesn't reset, so the check body only ever runs on
// whichever mount reaches it first — by the time its promise resolves,
// `onFile` is invoked via App.tsx's ref indirection, so it's irrelevant
// whether that was the transient first mount or the surviving second one.
let startupCheckStarted = false;

/**
 * Wires up file-association support when running as the Tauri desktop app
 * (a no-op in the plain web build). Calls `onFile` for a comic passed on the
 * command line at startup (double-clicked before the app was running), and
 * for any later double-click while the app is already open — the OS launches
 * a second process, which the single-instance plugin intercepts and forwards
 * to this one instead of opening a duplicate window.
 */
export function watchDesktopFileOpen(onFile: (source: ArchiveSource) => void): () => void {
  if (!isTauri()) return () => {};

  if (!startupCheckStarted) {
    startupCheckStarted = true;
    invoke<string | null>("take_pending_open_file")
      .then(async (path) => {
        if (path) onFile(await pathToSource(path));
      })
      .catch((err) => console.error("Failed to open the startup file", err));
  }

  // Unlike the startup check above, the ongoing listener is fine to tear
  // down and re-create per mount/unmount — StrictMode's transient first
  // mount sets one up and correctly tears it down on its cleanup; the
  // surviving second mount sets up the one that actually lasts.
  let cancelled = false;

  const unlistenPromise = listen<string>("open-file-path", (event) => {
    pathToSource(event.payload)
      .then((source) => {
        if (!cancelled) onFile(source);
      })
      .catch((err) => console.error("Failed to open the requested file", err));
  });

  return () => {
    cancelled = true;
    void unlistenPromise.then((unlisten) => unlisten());
  };
}
