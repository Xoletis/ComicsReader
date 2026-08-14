import { PERFORMANCE_PRESETS, PerformancePreset, savePerformancePreset } from "../lib/performance";

interface Props {
  preset: PerformancePreset;
  onChange: (preset: PerformancePreset) => void;
}

// The "Performance" tab of SettingsModal: how many pages the reader keeps
// decoded in memory around the current one. See lib/performance.ts for the
// actual tradeoff each preset makes.
export default function PerformanceTab({ preset, onChange }: Props) {
  const select = (next: PerformancePreset) => {
    savePerformancePreset(next);
    onChange(next);
  };

  return (
    <div className="performance-tab">
      <label className="shortcuts-detail__label">Mémoire du lecteur</label>
      <div className="performance-tab__options">
        {PERFORMANCE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`performance-tab__option${p.id === preset.id ? " active" : ""}`}
            onClick={() => select(p)}
          >
            <span className="performance-tab__option-label">{p.label}</span>
            <span className="performance-tab__option-desc">{p.description}</span>
          </button>
        ))}
      </div>
      <p className="appearance-tab__hint">
        S'applique au prochain changement de page — pas besoin de rouvrir le comic en cours.
      </p>
    </div>
  );
}
