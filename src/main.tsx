import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, loadActiveTheme } from "./lib/theme";
import "./styles.css";

// Applied before the first render (not inside a component effect) so there's
// no flash of the wrong theme while React mounts.
applyTheme(loadActiveTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
