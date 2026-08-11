export interface ShortcutAction {
  id: string;
  category: string;
  label: string;
  defaultKey: string;
}

// Every keyboard-triggerable action in the reader — this list drives both the
// actual keydown handling in Reader.tsx and the customization UI in
// ShortcutsModal.tsx, so adding a new shortcut only means adding one entry
// here. `category` groups actions in the shortcuts editor's left-hand tree,
// matching the reader's own Fichier/Lire/Options toolbar menus.
export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "openFile", category: "Fichier", label: "Ouvrir un fichier…", defaultKey: "o" },
  { id: "closeReader", category: "Fichier", label: "Fermer", defaultKey: "Escape" },
  { id: "nextPage", category: "Lire", label: "Page suivante", defaultKey: "ArrowRight" },
  { id: "prevPage", category: "Lire", label: "Page précédente", defaultKey: "ArrowLeft" },
  { id: "firstPage", category: "Lire", label: "Première page", defaultKey: "Home" },
  { id: "lastPage", category: "Lire", label: "Dernière page", defaultKey: "End" },
  { id: "toggleDoublePage", category: "Lire", label: "Double page", defaultKey: "d" },
  { id: "toggleThumbnails", category: "Lire", label: "Vignettes", defaultKey: "t" },
  { id: "togglePageBar", category: "Lire", label: "Curseur de page", defaultKey: "c" },
  { id: "zoomIn", category: "Options", label: "Zoom avant", defaultKey: "+" },
  { id: "zoomOut", category: "Options", label: "Zoom arrière", defaultKey: "-" },
  { id: "fitWidth", category: "Options", label: "Zoom largeur", defaultKey: "w" },
  { id: "fitHeight", category: "Options", label: "Zoom hauteur", defaultKey: "h" },
  { id: "toggleFullscreen", category: "Options", label: "Plein écran", defaultKey: "f" },
  { id: "refreshLibrary", category: "Bibliothèque", label: "Actualiser", defaultKey: "r" },
  { id: "newFolder", category: "Bibliothèque", label: "Nouveau dossier", defaultKey: "n" },
  { id: "searchLibrary", category: "Bibliothèque", label: "Rechercher", defaultKey: "s" },
  { id: "toggleLibraryTree", category: "Bibliothèque", label: "Arborescence", defaultKey: "a" },
  { id: "moveSelection", category: "Bibliothèque", label: "Déplacer la sélection", defaultKey: "m" },
  { id: "deleteSelection", category: "Bibliothèque", label: "Supprimer la sélection", defaultKey: "Delete" },
];

export interface ShortcutBinding {
  primary: string | null;
  secondary: string[];
}

export type ShortcutOverrides = Record<string, ShortcutBinding>;

const STORAGE_KEY = "cbreader:keyboardShortcuts";

export function loadShortcutOverrides(): ShortcutOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveShortcutOverrides(overrides: ShortcutOverrides): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
  }
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
  Delete: "Suppr",
};

// The single source of truth for how a key is displayed *and* matched: a raw
// key name (no modifiers) is normalized once here, and every combo — default
// or user-assigned — is built from this same normalized form, so a default
// like "d" and a captured "D" key press always compare equal.
export function formatKey(key: string): string {
  if (key in KEY_LABELS) return KEY_LABELS[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

// Turns a live keydown event into the same canonical combo string used for
// storage/display (e.g. "Ctrl+L", "→"). Returns null for a bare modifier
// press (Ctrl alone, etc.), which can't be a combo by itself.
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (e.key === "Control" || e.key === "Alt" || e.key === "Shift" || e.key === "Meta") return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Maj");
  if (e.metaKey) parts.push("Win");
  parts.push(formatKey(e.key));
  return parts.join("+");
}

export function defaultBinding(action: ShortcutAction): ShortcutBinding {
  return { primary: formatKey(action.defaultKey), secondary: [] };
}

export function effectiveBinding(overrides: ShortcutOverrides, actionId: string): ShortcutBinding {
  if (actionId in overrides) return overrides[actionId];
  const action = SHORTCUT_ACTIONS.find((a) => a.id === actionId);
  return action ? defaultBinding(action) : { primary: null, secondary: [] };
}

// Reverse lookup ("this combo was pressed, which action fires?") covering
// both primary and secondary bindings — rebuilt whenever overrides change
// rather than kept incrementally in sync; the action list is short enough
// that this is cheap either way.
export function buildComboToActionMap(overrides: ShortcutOverrides): Map<string, string> {
  const map = new Map<string, string>();
  for (const action of SHORTCUT_ACTIONS) {
    const binding = effectiveBinding(overrides, action.id);
    if (binding.primary) map.set(binding.primary, action.id);
    for (const combo of binding.secondary) map.set(combo, action.id);
  }
  return map;
}

// Removes a combo from whichever action currently holds it (primary or
// secondary), so a newly-assigned combo never fires two actions at once.
// Returns a fresh overrides object; a no-op combo (not held by anyone, or
// only held by `exceptActionId`) still returns a shallow copy for callers
// that always spread the result.
export function stripComboFromOverrides(overrides: ShortcutOverrides, combo: string, exceptActionId: string): ShortcutOverrides {
  const next: ShortcutOverrides = { ...overrides };
  for (const action of SHORTCUT_ACTIONS) {
    if (action.id === exceptActionId) continue;
    const binding = effectiveBinding(overrides, action.id);
    const hasPrimary = binding.primary === combo;
    const hasSecondary = binding.secondary.includes(combo);
    if (!hasPrimary && !hasSecondary) continue;
    next[action.id] = {
      primary: hasPrimary ? null : binding.primary,
      secondary: hasSecondary ? binding.secondary.filter((c) => c !== combo) : binding.secondary,
    };
  }
  return next;
}
