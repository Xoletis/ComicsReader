import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate, installUpdate } from "../lib/updater";

type Status =
  | { kind: "idle" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; percent: number | null }
  | { kind: "error"; message: string };

export default function UpdateBanner() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    checkForUpdate()
      .then((update) => {
        if (!cancelled && update) setStatus({ kind: "available", update });
      })
      .catch((err) => console.error("Update check failed", err));
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.kind === "idle") return null;

  if (status.kind === "available") {
    const { update } = status;
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
                await installUpdate(update, (downloaded, total) => {
                  setStatus({
                    kind: "downloading",
                    percent: total ? Math.round((downloaded / total) * 100) : null,
                  });
                });
              } catch (err) {
                console.error("Update install failed", err);
                setStatus({
                  kind: "error",
                  message: err instanceof Error ? err.message : String(err),
                });
              }
            }}
          >
            Mettre à jour et redémarrer
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
