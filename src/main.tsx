import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, loadActiveTheme } from "./lib/theme";
import "./styles.css";

// Applied before the first render (not inside a component effect) so there's
// no flash of the wrong theme while React mounts.
applyTheme(loadActiveTheme());

// TEMPORARY verification trigger for the themes/ folder auto-creation — remove after confirming.
Promise.all([import("./lib/themesFileStore"), import("@tauri-apps/plugin-fs")]).then(
  async ([{ loadThemesFromFolder, isThemesFolderSupported }, { writeTextFile, BaseDirectory }]) => {
    if (!isThemesFolderSupported()) return;
    const themes = await loadThemesFromFolder();
    const summary = themes.map((t) => `${t.id}: ${t.name}`).join("\n");
    await writeTextFile("debug-result.txt", summary, { baseDir: BaseDirectory.AppConfig });
  }
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
