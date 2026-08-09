import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

// A no-op outside the desktop build — the web app has no installer to update.
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauri()) return null;
  return check();
}

export async function installUpdate(
  update: Update,
  onProgress: (downloadedBytes: number, totalBytes: number | null) => void
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress(0, total);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress(downloaded, total);
        break;
    }
  });

  await relaunch();
}
