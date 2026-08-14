import { Fragment, useEffect } from "react";
import { ComicInfo } from "../lib/archive";

interface Props {
  comicInfo: ComicInfo | null;
  pageCount: number;
  format: string;
  onClose: () => void;
}

const FIELDS: [keyof ComicInfo, string][] = [
  ["series", "Série"],
  ["number", "Numéro"],
  ["volume", "Volume"],
  ["title", "Titre"],
  ["writer", "Scénario"],
  ["penciller", "Dessin"],
  ["inker", "Encrage"],
  ["colorist", "Couleurs"],
  ["letterer", "Lettrage"],
  ["coverArtist", "Couverture"],
  ["editor", "Édition"],
  ["publisher", "Éditeur"],
  ["genre", "Genre"],
  ["characters", "Personnages"],
  ["ageRating", "Classification"],
  ["languageISO", "Langue"],
  ["web", "Web"],
  ["summary", "Résumé"],
];

// A lighter counterpart to Library's InfoModal — this one describes the
// comic already open in the reader (an OpenedArchive), which has no
// FileSystemFileHandle to re-read, just the ComicInfo.xml already parsed at
// open time (see lib/archive.ts).
export default function ComicInfoModal({ comicInfo, pageCount, format, onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const date = comicInfo ? [comicInfo.year, comicInfo.month, comicInfo.day].filter(Boolean).join("-") : "";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--info" onClick={(e) => e.stopPropagation()}>
        <h3>Informations</h3>
        <dl className="info-list">
          <dt>Format</dt>
          <dd>{format.toUpperCase()}</dd>
          <dt>Pages</dt>
          <dd>{pageCount}</dd>
          {date && (
            <>
              <dt>Date</dt>
              <dd>{date}</dd>
            </>
          )}
          {FIELDS.map(([key, label]) => {
            const value = comicInfo?.[key];
            if (!value) return null;
            return (
              <Fragment key={key}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            );
          })}
          {!comicInfo && (
            <>
              <dt>ComicInfo.xml</dt>
              <dd>Absent de cette archive</dd>
            </>
          )}
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
