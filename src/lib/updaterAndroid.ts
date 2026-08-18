// The Android equivalent of lib/updater.ts. tauri-plugin-updater has no
// mobile implementation (see src-tauri/Cargo.toml — desktop-only), and its
// own latest.json manifest never lists an Android artifact anyway, so there's
// nothing to reuse from that side. This checks GitHub's public releases API
// directly, and — instead of a plugin-updater style silent self-replace,
// which doesn't exist for a sideloaded APK — downloads the new APK and hands
// it to the system package installer via tauri-plugin-android-fs's Opener
// (already integrated for the Library feature; see lib/libraryAndroid.ts).
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import * as AndroidFs from "tauri-plugin-android-fs-api";

// Despite its synchronous, no-args signature, AndroidFs.isAndroid() actually
// reaches into Tauri's native bridge and throws outright in any context
// without a Tauri runtime at all (confirmed by direct testing while building
// the Library folder feature) — isTauri() short-circuits that, and the
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

const RELEASES_API_URL = "https://api.github.com/repos/Xoletis/ComicsReader/releases/latest";
const APK_NAME_RE = /^CBReader_.*\.apk$/i;

export interface AndroidUpdateInfo {
  version: string;
  downloadUrl: string;
}

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubReleaseAsset[];
}

// Plain numeric X.Y.Z comparison — sufficient since every version this app
// has ever used follows that shape; no need for a full semver dependency.
function isNewer(remote: string, local: string): boolean {
  const r = remote.split(".").map(Number);
  const l = local.split(".").map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv !== lv) return rv > lv;
  }
  return false;
}

export async function checkForUpdateAndroid(): Promise<AndroidUpdateInfo | null> {
  const response = await fetch(RELEASES_API_URL);
  if (!response.ok) throw new Error(`Échec de la vérification de mise à jour (HTTP ${response.status}).`);
  const release: GithubRelease = await response.json();
  const remoteVersion = release.tag_name.replace(/^v/, "");
  const localVersion = await getVersion();
  if (!isNewer(remoteVersion, localVersion)) return null;

  const apk = release.assets.find((asset) => APK_NAME_RE.test(asset.name));
  if (!apk) return null;

  return { version: remoteVersion, downloadUrl: apk.browser_download_url };
}

// Downloads via a streamed reader (not a plain arrayBuffer() fetch) so
// onProgress can report real byte counts the same way installUpdate() in
// lib/updater.ts does for the desktop download — the two share a UI in
// UpdateBanner.tsx and should feel the same while downloading.
async function downloadWithProgress(
  url: string,
  onProgress: (downloadedBytes: number, totalBytes: number | null) => void
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Échec du téléchargement (HTTP ${response.status}).`);
  const total = Number(response.headers.get("content-length")) || null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloaded = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.byteLength;
    onProgress(downloaded, total);
  }
  const bytes = new Uint8Array(downloaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function installUpdateAndroid(
  update: AndroidUpdateInfo,
  onProgress: (downloadedBytes: number, totalBytes: number | null) => void
): Promise<void> {
  const bytes = await downloadWithProgress(update.downloadUrl, onProgress);
  const uri = await AndroidFs.createNewPublicFile(
    AndroidFs.PublicGeneralPurposeDir.Download,
    `CBReader_${update.version}.apk`,
    "application/vnd.android.package-archive"
  );
  await AndroidFs.writeFile(uri, bytes);
  // Hands off to the system package installer (the only app on a stock
  // device that registers for this MIME type) — the user still has to
  // confirm the install themselves, same as any sideloaded APK.
  await AndroidFs.showViewFileAppChooser(uri);
}
