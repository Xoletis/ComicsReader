import { useEffect, useState } from "react";
import { loadActiveTheme } from "../lib/theme";
import { ThemeFile } from "../lib/themeFile";
import AppearanceTab from "./AppearanceTab";
import ShortcutsTab from "./ShortcutsTab";
import { ShortcutOverrides } from "../lib/shortcuts";

interface Props {
  onClose: () => void;
  onShortcutsChange: (overrides: ShortcutOverrides) => void;
}

type Tab = "appearance" | "shortcuts";

export default function SettingsModal({ onClose, onShortcutsChange }: Props) {
  const [tab, setTab] = useState<Tab>("appearance");
  const [theme, setTheme] = useState<ThemeFile>(() => loadActiveTheme());
  // Suspended while ShortcutsTab is capturing a key combo, so pressing
  // Escape there cancels the capture instead of also closing this modal.
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (capturing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [capturing, onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-tabs">
          <button type="button" className={`settings-tabs__tab${tab === "appearance" ? " active" : ""}`} onClick={() => setTab("appearance")}>
            Apparence
          </button>
          <button type="button" className={`settings-tabs__tab${tab === "shortcuts" ? " active" : ""}`} onClick={() => setTab("shortcuts")}>
            Raccourcis
          </button>
        </div>

        {tab === "appearance" ? (
          <AppearanceTab theme={theme} onChange={setTheme} />
        ) : (
          <ShortcutsTab onChange={onShortcutsChange} onCapturingChange={setCapturing} />
        )}

        <div className="modal__actions">
          <button type="button" className="active" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
