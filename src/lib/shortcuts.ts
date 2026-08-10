export interface ShortcutAction {
  id: string;
  label: string;
  defaultKey: string;
}

// Every keyboard-triggerable action in the reader — this list drives both the
// actual keydown handling in Reader.tsx and the customization UI in
// ShortcutsModal.tsx, so adding a new shortcut only means adding one entry here.
export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "nextPage", label: "Page suivante", defaultKey: "ArrowRight" },
  { id: "prevPage", label: "Page précédente", defaultKey: "ArrowLeft" },
  { id: "firstPage", label: "Première page", defaultKey: "Home" },
  { id: "lastPage", label: "Dernière page", defaultKey: "End" },
  { id: "zoomIn", label: "Zoom avant", defaultKey: "+" },
  { id: "zoomOut", label: "Zoom arrière", defaultKey: "-" },
  { id: "fitWidth", label: "Zoom largeur", defaultKey: "w" },
  { id: "fitHeight", label: "Zoom hauteur", defaultKey: "h" },
  { id: "toggleDoublePage", label: "Double page", defaultKey: "d" },
  { id: "toggleFullscreen", label: "Plein écran", defaultKey: "f" },
  { id: "toggleThumbnails", label: "Vignettes", defaultKey: "t" },
  { id: "togglePageBar", label: "Curseur de page", defaultKey: "c" },
  { id: "openFile", label: "Ouvrir un fichier", defaultKey: "o" },
  { id: "closeReader", label: "Fermer", defaultKey: "Escape" },
];

export type ShortcutMap = Record<string, string>;

const STORAGE_KEY = "cbreader:keyboardShortcuts";

export function loadShortcutOverrides(): ShortcutMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveShortcutOverrides(overrides: ShortcutMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
  }
}

export function effectiveKey(overrides: ShortcutMap, actionId: string): string {
  const action = SHORTCUT_ACTIONS.find((a) => a.id === actionId);
  return overrides[actionId] ?? action?.defaultKey ?? "";
}

// A quick reverse lookup ("this key is pressed, which action does it fire?"),
// rebuilt whenever the overrides change rather than kept incrementally in
// sync — the action list is short enough that this is cheap either way.
export function buildKeyToActionMap(overrides: ShortcutMap): Map<string, string> {
  const map = new Map<string, string>();
  for (const action of SHORTCUT_ACTIONS) {
    map.set(overrides[action.id] ?? action.defaultKey, action.id);
  }
  return map;
}

const KEY_LABELS: Record<string, string> = {
  ArrowRight: "→",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowDown: "↓",
  " ": "Espace",
  Escape: "Échap",
  Home: "Origine",
  End: "Fin",
  PageUp: "Page préc.",
  PageDown: "Page suiv.",
  Tab: "Tab",
};

export function formatKey(key: string): string {
  if (key in KEY_LABELS) return KEY_LABELS[key];
  return key.length === 1 ? key.toUpperCase() : key;
}
