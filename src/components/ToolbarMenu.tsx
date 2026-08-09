import { useEffect, useRef, useState } from "react";

interface Props {
  label: string;
  children: React.ReactNode;
}

// A lightweight dropdown menu for the reader's toolbar (File/Read/Options) —
// not the same component as the library's right-click context menu, which is
// anchored to a click position and has to reposition itself off-screen edges;
// this one is always anchored under its own trigger button, so it doesn't
// need any of that.
export default function ToolbarMenu({ label, children }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="toolbar-menu" ref={rootRef}>
      <button type="button" className={`toolbar-menu__trigger${open ? " active" : ""}`} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        // Closes on any item click (matches native menu conventions) — the
        // item's own onClick still runs first since React dispatches from
        // the target outward, this only fires afterward as it bubbles here.
        <div className="toolbar-menu__dropdown" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
