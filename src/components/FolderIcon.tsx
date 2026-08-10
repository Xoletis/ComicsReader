interface Props {
  color?: string;
  className?: string;
}

const DEFAULT_COLOR = "var(--color-accent)";

// A flat Windows-Explorer-style folder glyph. Recolored via `color` (sets
// the SVG's `currentColor`) rather than tinting a card behind it. Falls
// back to the active theme's accent color rather than a fixed hex, so
// uncolored folders follow theme changes like everything else.
export default function FolderIcon({ color, className }: Props) {
  return (
    <svg viewBox="0 0 100 80" className={className} style={{ color: color ?? DEFAULT_COLOR }} xmlns="http://www.w3.org/2000/svg">
      <path
        fill="currentColor"
        d="M8,20 Q8,12 16,12 L38,12 L46,20 L84,20 Q92,20 92,28 L92,64 Q92,72 84,72 L16,72 Q8,72 8,64 Z"
      />
    </svg>
  );
}
