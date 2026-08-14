export interface CropRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_CROP: CropRect = { top: 0, right: 0, bottom: 0, left: 0 };

export function isNoCrop(crop: CropRect): boolean {
  return crop.top === 0 && crop.right === 0 && crop.bottom === 0 && crop.left === 0;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Impossible de charger l'image "${url}".`));
    img.src = url;
  });
}

export async function probeDimensions(url: string): Promise<{ width: number; height: number }> {
  const img = await loadImage(url);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

// Analysis runs on a downscaled copy — the crop only needs to be
// approximately right, and scanning a full-resolution scan (potentially
// thousands of pixels per side) for every page flipped through would be
// needlessly slow for no visible benefit.
const ANALYSIS_MAX_DIM = 220;
// Per-channel distance from the detected background color still counted as
// "margin" — generous enough to absorb scan noise/compression artifacts in
// a nominally-white border without also swallowing light-colored art.
const MARGIN_TOLERANCE = 18;
// Never crop more than this fraction from any single edge — guards against
// runaway false positives on genuinely uniform full-bleed art (e.g. a solid
// black splash page reads as "all background" without this cap).
const MAX_CROP_FRACTION = 0.25;

// Detects a uniform (typically white or black) scan margin around a comic
// page by sampling the background color from the four corners, then walking
// inward from each edge until a pixel differs from it by more than the
// tolerance. Returns crop fractions (0..1) of the image's own dimensions,
// or NO_CROP if nothing worth cropping was found or analysis failed.
export async function detectMarginCrop(url: string): Promise<CropRect> {
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return NO_CROP;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    const at = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return [data[i], data[i + 1], data[i + 2]] as const;
    };
    const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
    const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((sum, p) => sum + p[c], 0) / 4));

    const isBackground = (x: number, y: number) => {
      const [r, g, b] = at(x, y);
      return Math.abs(r - bg[0]) <= MARGIN_TOLERANCE && Math.abs(g - bg[1]) <= MARGIN_TOLERANCE && Math.abs(b - bg[2]) <= MARGIN_TOLERANCE;
    };
    const rowIsBackground = (y: number) => {
      for (let x = 0; x < w; x++) if (!isBackground(x, y)) return false;
      return true;
    };
    const colIsBackground = (x: number) => {
      for (let y = 0; y < h; y++) if (!isBackground(x, y)) return false;
      return true;
    };

    const maxRows = Math.floor(h * MAX_CROP_FRACTION);
    const maxCols = Math.floor(w * MAX_CROP_FRACTION);

    let top = 0;
    while (top < maxRows && rowIsBackground(top)) top++;
    let bottom = 0;
    while (bottom < maxRows && rowIsBackground(h - 1 - bottom)) bottom++;
    let left = 0;
    while (left < maxCols && colIsBackground(left)) left++;
    let right = 0;
    while (right < maxCols && colIsBackground(w - 1 - right)) right++;

    // A one- or two-pixel margin at this resolution is scan noise, not a
    // real border worth clipping — not worth the (tiny) visual jitter.
    if (top <= 2 && bottom <= 2 && left <= 2 && right <= 2) return NO_CROP;

    return { top: top / h, right: right / w, bottom: bottom / h, left: left / w };
  } catch {
    return NO_CROP;
  }
}

// Combines a rotation angle with a crop rect into one CSS transform (plus
// matching clip-path), so callers never juggle two separate `transform`
// declarations. The crop math: clip-path hides everything outside the
// rect in the element's own untransformed box, then translate+scale blows
// that remaining region back up to fill the full box — applied *before*
// rotation in the composed transform (rightmost = applied first to a point)
// so the crop stays anchored to the image's own unrotated content.
export function buildImageTransform(rotationDeg: number, crop: CropRect): { transform?: string; clipPath?: string } {
  const parts: string[] = [];
  let clipPath: string | undefined;

  if (!isNoCrop(crop)) {
    const sx = 1 / (1 - crop.left - crop.right);
    const sy = 1 / (1 - crop.top - crop.bottom);
    const tx = -100 * crop.left * sx;
    const ty = -100 * crop.top * sy;
    clipPath = `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`;
    parts.push(`translate(${tx}%, ${ty}%)`, `scale(${sx}, ${sy})`);
  }
  if (rotationDeg !== 0) parts.unshift(`rotate(${rotationDeg}deg)`);

  return { transform: parts.length ? parts.join(" ") : undefined, clipPath };
}

// A page is considered a two-page spread scanned as one wide image when its
// aspect ratio clearly favors landscape — a plain portrait page never trips
// this, while an actual spread (roughly double the width of a single page)
// comfortably clears it.
const SPREAD_ASPECT_THRESHOLD = 1.15;

export function isSpreadAspect(width: number, height: number): boolean {
  return height > 0 && width / height > SPREAD_ASPECT_THRESHOLD;
}
