import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf-8"));
// Set before Vite resolves its env so it's picked up as if it came from a
// .env file — more reliable here than esbuild's `define` identifier
// replacement, which wasn't substituting in this environment for reasons
// that didn't reproduce even via Vite's own transformRequest() API.
process.env.VITE_APP_VERSION = pkg.version;

export default defineConfig({
  plugins: [react()],
});
