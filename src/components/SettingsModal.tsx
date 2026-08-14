import { useEffect, useState } from "react";
import { ComfortFilterId } from "../lib/comfortFilter";
import { loadActiveTheme } from "../lib/theme";
import { ThemeFile } from "../lib/themeFile";
import { PerformancePreset } from "../lib/performance";
import AppearanceTab from "./AppearanceTab";
import PerformanceTab from "./PerformanceTab";
import ShortcutsTab from "./ShortcutsTab";
import { ShortcutOverrides } from "../lib/shortcuts";

interface Props {
  onClose: () => void;
  onShortcutsChange: (overrides: ShortcutOverrides) => void;
  performancePreset: PerformancePreset;
  onPerformanceChange: (preset: PerformancePreset) => void;
  comfortFilter: ComfortFilterId;
  onComfortFilterChange: (id: ComfortFilterId) => void;
}

type Tab = "appearance" | "shortcuts" | "performance";

export default function SettingsModal({
  onClose,
  onShortcutsChange,
  performancePreset,
  onPerformanceChange,
  comfortFilter,
  onComfortFilterChange,
}: Props) {
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
          <button type="button" className={`settings-tabs__tab${tab === "performance" ? " active" : ""}`} onClick={() => setTab("performance")}>
            Performance
          </button>
        </div>

        {tab === "appearance" && (
          <AppearanceTab
            theme={theme}
            onChange={setTheme}
            comfortFilter={comfortFilter}
            onComfortFilterChange={onComfortFilterChange}
          />
        )}
        {tab === "shortcuts" && <ShortcutsTab onChange={onShortcutsChange} onCapturingChange={setCapturing} />}
        {tab === "performance" && <PerformanceTab preset={performancePreset} onChange={onPerformanceChange} />}

        <div className="modal__actions">
          <button type="button" className="active" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
