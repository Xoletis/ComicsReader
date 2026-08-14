import { withStore } from "./db";

// Reuses the app's single shared IndexedDB store (see lib/db.ts) with a
// namespaced key, rather than a dedicated object store — consistent with
// how every other feature in that file works, and avoids a schema/version
// bump for something that's just an accelerator, not durable data.
const KEY_PREFIX = "coverCache:";
// A cover only ever needs to be legible at grid-thumbnail size — caching it
// full-resolution would make the "faster" point moot once a library grows
// past a few dozen comics.
const THUMB_MAX_DIM = 320;

interface CachedCover {
  blob: Blob;
  lastModified: number;
}

function keyFor(name: string, size: number): string {
  return `${KEY_PREFIX}${name}:${size}`;
}

// Returns an object URL for the cached thumbnail if one exists and the file
// hasn't changed since it was cached (compared by lastModified), or null —
// null means "go extract the real cover", the normal slow path.
export async function loadCachedCoverUrl(name: string, size: number, lastModified: number): Promise<string | null> {
  try {
    const cached = await withStore<CachedCover | undefined>("readonly", (store) => store.get(keyFor(name, size)));
    if (!cached || cached.lastModified !== lastModified) return null;
    return URL.createObjectURL(cached.blob);
  } catch {
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Impossible de charger l'image "${url}".`));
    img.src = url;
  });
}

async function downscale(url: string, maxDim: number): Promise<Blob | null> {
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  } catch {
    return null;
  }
}

// Fire-and-forget: the full-resolution cover extracted from the archive is
// already on screen by the time this is called, so downscaling and writing
// to IndexedDB happens in the background and never blocks or affects what's
// displayed — it only pays off on the *next* time this comic's cover loads.
export function cacheCoverInBackground(name: string, size: number, lastModified: number, coverUrl: string): void {
  void (async () => {
    const blob = await downscale(coverUrl, THUMB_MAX_DIM);
    if (!blob) return;
    try {
      await withStore("readwrite", (store) => store.put({ blob, lastModified } satisfies CachedCover, keyFor(name, size)));
    } catch {
      // IndexedDB indisponible/quota plein - le cache est un accélérateur, pas critique
    }
  })();
}
