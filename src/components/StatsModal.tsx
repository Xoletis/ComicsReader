import { useEffect } from "react";
import { formatDuration, loadTotalPagesRead, loadTotalTimeMs, scanLibraryReadCounts } from "../lib/readingStats";

interface Props {
  onClose: () => void;
}

// A snapshot, not a live view — read once when the modal opens, same as
// InfoModal/ComicInfoModal. All figures come straight out of localStorage
// (lib/readingStats.ts, lib/readStatus.ts): a lifetime time/pages counter
// accumulated by every Reader session, and a scan of every comic that has
// ever had progress or an explicit read-status override saved.
export default function StatsModal({ onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const totalTimeMs = loadTotalTimeMs();
  const totalPages = loadTotalPagesRead();
  const { read, inProgress } = scanLibraryReadCounts();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--info" onClick={(e) => e.stopPropagation()}>
        <h3>Statistiques de lecture</h3>
        <dl className="info-list">
          <dt>Temps de lecture total</dt>
          <dd>{totalTimeMs > 0 ? formatDuration(totalTimeMs) : "—"}</dd>
          <dt>Pages lues</dt>
          <dd>{totalPages}</dd>
          <dt>Comics terminés</dt>
          <dd>{read}</dd>
          <dt>Comics en cours</dt>
          <dd>{inProgress}</dd>
        </dl>
        <div className="modal__actions">
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
