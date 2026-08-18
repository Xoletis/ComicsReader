import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate, installUpdate } from "../lib/updater";
import { AndroidUpdateInfo, checkForUpdateAndroid, installUpdateAndroid, isAndroidFsSupported } from "../lib/updaterAndroid";

// Desktop's Update carries its own downloadAndInstall(); Android's plain
// {version, downloadUrl} instead goes through installUpdateAndroid() (see
// lib/updaterAndroid.ts) — kept as a discriminated union rather than one
// shared shape so each branch below stays correctly typed against the
// function it actually calls.
type Status =
  | { kind: "idle" }
  | { kind: "available"; platform: "desktop"; update: Update }
  | { kind: "available"; platform: "android"; update: AndroidUpdateInfo }
  | { kind: "downloading"; percent: number | null }
  | { kind: "error"; message: string };

export default function UpdateBanner() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    const check = isAndroidFsSupported()
      ? checkForUpdateAndroid().then((update) => update && setStatus({ kind: "available", platform: "android", update }))
      : checkForUpdate().then((update) => update && setStatus({ kind: "available", platform: "desktop", update }));
    check.catch((err) => {
      if (!cancelled) console.error("Update check failed", err);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.kind === "idle") return null;

  if (status.kind === "available") {
    const { update, platform } = status;
    return (
      <div className="update-banner">
        <span className="update-banner__text">
          Une nouvelle version est disponible : <strong>{update.version}</strong>
        </span>
        <div className="update-banner__actions">
          <button onClick={() => setStatus({ kind: "idle" })}>Plus tard</button>
          <button
            className="update-banner__primary"
            onClick={async () => {
              setStatus({ kind: "downloading", percent: null });
              try {
                const onProgress = (downloaded: number, total: number | null) => {
                  setStatus({
                    kind: "downloading",
                    percent: total ? Math.round((downloaded / total) * 100) : null,
                  });
                };
                if (platform === "android") await installUpdateAndroid(update, onProgress);
                else await installUpdate(update, onProgress);
              } catch (err) {
                console.error("Update install failed", err);
                setStatus({
                  kind: "error",
                  message: err instanceof Error ? err.message : String(err),
                });
              }
            }}
          >
            {platform === "android" ? "Télécharger et installer" : "Mettre à jour et redémarrer"}
          </button>
        </div>
      </div>
    );
  }

  if (status.kind === "downloading") {
    return (
      <div className="update-banner">
        <span className="update-banner__text">
          Téléchargement de la mise à jour{status.percent !== null ? ` (${status.percent}%)` : "…"}
        </span>
      </div>
    );
  }

  return (
    <div className="update-banner update-banner--error">
      <span className="update-banner__text">Échec de la mise à jour : {status.message}</span>
      <button onClick={() => setStatus({ kind: "idle" })}>Fermer</button>
    </div>
  );
}
