import { useEffect } from "react";
import { FOLDER_COLOR_PRESETS } from "../lib/folderColors";
import FolderIcon from "./FolderIcon";

interface Props {
  folderName: string;
  currentColor: string | null;
  onCancel: () => void;
  onSelect: (color: string | null) => void;
}

export default function FolderColorModal({ folderName, currentColor, onCancel, onSelect }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Couleur de « {folderName} »</h3>
        <div className="color-swatches">
          <button
            type="button"
            className={`color-swatch color-swatch--default ${!currentColor ? "color-swatch--selected" : ""}`}
            title="Par défaut"
            onClick={() => onSelect(null)}
          >
            ✕
          </button>
          {FOLDER_COLOR_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.value}
              className={`color-swatch ${currentColor === preset.value ? "color-swatch--selected" : ""}`}
              title={preset.name}
              onClick={() => onSelect(preset.value)}
            >
              <FolderIcon color={preset.value} className="color-swatch__icon" />
            </button>
          ))}
        </div>
        <div className="modal__actions">
          <button type="button" onClick={onCancel}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
