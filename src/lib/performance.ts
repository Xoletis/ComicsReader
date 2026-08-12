export interface PerformancePreset {
  id: string;
  label: string;
  description: string;
  /** How many pages around the current one to prefetch in the background. */
  prefetchRadius: number;
  /** How many pages around the current one stay decoded in memory before eviction. */
  keepRadius: number;
}

// The tradeoff a reader with hundreds of decoded pages in flight always has:
// prefetching further ahead makes navigation feel smoother, at the cost of
// keeping more full-resolution images decoded in memory at once. "Normal"
// matches what the reader always used before this was configurable.
export const PERFORMANCE_PRESETS: PerformancePreset[] = [
  {
    id: "economical",
    label: "Économe",
    description: "Moins de pages gardées en mémoire — utile sur une machine avec peu de RAM.",
    prefetchRadius: 1,
    keepRadius: 2,
  },
  {
    id: "normal",
    label: "Normal",
    description: "Bon compromis pour la plupart des ordinateurs.",
    prefetchRadius: 2,
    keepRadius: 5,
  },
  {
    id: "performance",
    label: "Performant",
    description: "Plus de pages gardées en mémoire, pour une navigation plus fluide sur les gros comics.",
    prefetchRadius: 4,
    keepRadius: 10,
  },
];

const STORAGE_KEY = "cbreader:performancePreset";
const DEFAULT_PRESET = PERFORMANCE_PRESETS[1];

export function loadPerformancePreset(): PerformancePreset {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return PERFORMANCE_PRESETS.find((p) => p.id === id) ?? DEFAULT_PRESET;
  } catch {
    return DEFAULT_PRESET;
  }
}

export function savePerformancePreset(preset: PerformancePreset): void {
  try {
    localStorage.setItem(STORAGE_KEY, preset.id);
  } catch {
    // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
  }
}
