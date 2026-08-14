export type ComfortFilterId = "none" | "sepia" | "night" | "dim";

export interface ComfortFilterOption {
  id: ComfortFilterId;
  label: string;
  // CSS filter() value applied to the page image; null for "no filter".
  filter: string | null;
}

// Applied to the page image itself (not the UI theme) — a reading-comfort
// adjustment independent of the app's own dark/light theme.
export const COMFORT_FILTERS: ComfortFilterOption[] = [
  { id: "none", label: "Aucun", filter: null },
  { id: "sepia", label: "Sépia", filter: "sepia(0.6) brightness(0.95)" },
  { id: "night", label: "Nuit (anti lumière bleue)", filter: "sepia(0.25) saturate(0.9) brightness(0.8) contrast(0.95)" },
  { id: "dim", label: "Luminosité réduite", filter: "brightness(0.7)" },
];

const STORAGE_KEY = "cbreader:comfortFilter";

export function loadComfortFilter(): ComfortFilterId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return COMFORT_FILTERS.find((f) => f.id === raw)?.id ?? "none";
  } catch {
    return "none";
  }
}

export function saveComfortFilter(id: ComfortFilterId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
  }
}
