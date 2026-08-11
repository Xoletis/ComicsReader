// The color palette every theme file must provide — one key per CSS custom
// property the app actually styles with (see the CSS_VAR_NAMES map below and
// the :root block at the top of styles.css, which only supplies the
// fallback/first-paint values). Anyone can hand-author a JSON file with this
// exact shape to create a custom theme; src/themes/dark.json and light.json
// are the two built-in themes expressed the same way, not special-cased.
export interface ThemeColors {
  bg: string;
  bgAlt: string;
  bgModal: string;
  bgPanel: string;
  bgInset: string;
  bgBlack: string;
  surface: string;
  surfaceHover: string;
  surfaceHover2: string;
  accentBg: string;
  accentBorder: string;
  border: string;
  accent: string;
  accentHover: string;
  accentText: string;
  accentTextSoft: string;
  text: string;
  textStrong: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;
  textDimmer: string;
  textFaint: string;
  danger: string;
  dangerStrong: string;
  dangerBorder: string;
}

export interface ThemeFile {
  id: string;
  name: string;
  colors: ThemeColors;
  /** CSS font-family stack, e.g. "'Fira Code', monospace". Optional — falls
   *  back to the app's default system font stack when omitted, so existing
   *  theme files written before this field existed still validate. */
  font?: string;
}

export const DEFAULT_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const COLOR_KEYS: (keyof ThemeColors)[] = [
  "bg",
  "bgAlt",
  "bgModal",
  "bgPanel",
  "bgInset",
  "bgBlack",
  "surface",
  "surfaceHover",
  "surfaceHover2",
  "accentBg",
  "accentBorder",
  "border",
  "accent",
  "accentHover",
  "accentText",
  "accentTextSoft",
  "text",
  "textStrong",
  "textSecondary",
  "textMuted",
  "textDim",
  "textDimmer",
  "textFaint",
  "danger",
  "dangerStrong",
  "dangerBorder",
];

const CSS_VAR_NAMES: Record<keyof ThemeColors, string> = {
  bg: "--color-bg",
  bgAlt: "--color-bg-alt",
  bgModal: "--color-bg-modal",
  bgPanel: "--color-bg-panel",
  bgInset: "--color-bg-inset",
  bgBlack: "--color-bg-black",
  surface: "--color-surface",
  surfaceHover: "--color-surface-hover",
  surfaceHover2: "--color-surface-hover-2",
  accentBg: "--color-accent-bg",
  accentBorder: "--color-accent-border",
  border: "--color-border",
  accent: "--color-accent",
  accentHover: "--color-accent-hover",
  accentText: "--color-accent-text",
  accentTextSoft: "--color-accent-text-soft",
  text: "--color-text",
  textStrong: "--color-text-strong",
  textSecondary: "--color-text-secondary",
  textMuted: "--color-text-muted",
  textDim: "--color-text-dim",
  textDimmer: "--color-text-dimmer",
  textFaint: "--color-text-faint",
  danger: "--color-danger",
  dangerStrong: "--color-danger-strong",
  dangerBorder: "--color-danger-border",
};

export function isValidThemeFile(value: unknown): value is ThemeFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id.trim()) return false;
  if (typeof v.name !== "string" || !v.name.trim()) return false;
  if (!v.colors || typeof v.colors !== "object") return false;
  if (v.font !== undefined && (typeof v.font !== "string" || !v.font.trim())) return false;
  const colors = v.colors as Record<string, unknown>;
  return COLOR_KEYS.every((key) => typeof colors[key] === "string" && colors[key] !== "");
}

// Applied as inline custom properties on <html> rather than swapping a CSS
// class/stylesheet — this is what lets an arbitrary, never-seen-at-build-time
// JSON file re-theme the app, not just a fixed set of classes baked into
// styles.css. Covers everything a theme controls: colors *and* font (icons
// aren't listed separately because every icon in the app is an inline SVG
// using stroke/fill="currentColor", so they already follow --color-text/
// --color-accent wherever they're drawn — no separate variable needed).
export function applyThemeFile(theme: ThemeFile): void {
  const root = document.documentElement.style;
  for (const key of COLOR_KEYS) {
    root.setProperty(CSS_VAR_NAMES[key], theme.colors[key]);
  }
  root.setProperty("--font-family", theme.font ?? DEFAULT_FONT);
}

// Built-in themes are just JSON files under src/themes/, told apart from
// user-provided ones only by where they were loaded from — same format,
// same validation, no special-cased fields.
const builtInModules = import.meta.glob<ThemeFile>("../themes/*.json", { eager: true, import: "default" });

export const BUILT_IN_THEMES: ThemeFile[] = Object.values(builtInModules).filter(isValidThemeFile);
