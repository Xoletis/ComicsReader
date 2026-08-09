const STORAGE_KEY = "cbreader:folderColors";

export const FOLDER_COLOR_PRESETS = [
  { name: "Bleu", value: "#4a7fd6" },
  { name: "Vert", value: "#4caf7d" },
  { name: "Jaune", value: "#f4c94f" },
  { name: "Rouge", value: "#e0605c" },
  { name: "Violet", value: "#9b6fd6" },
  { name: "Orange", value: "#e08a4a" },
  { name: "Turquoise", value: "#4ac9c9" },
  { name: "Gris", value: "#9a9a9a" },
];

// Folders have no stable ID across renames/moves, so colors are keyed by
// their path (names) from the library root. Renaming or moving a colored
// folder loses its color — an accepted trade-off for not tracking a
// separate identity for filesystem handles.
export function folderColorKey(parentPathNames: string[], folderName: string): string {
  return [...parentPathNames, folderName].join("/");
}

export function loadFolderColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveFolderColor(key: string, color: string | null): Record<string, string> {
  const map = loadFolderColors();
  if (color) map[key] = color;
  else delete map[key];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage indisponible (mode privé, quota...) - on ignore silencieusement
  }
  return map;
}
