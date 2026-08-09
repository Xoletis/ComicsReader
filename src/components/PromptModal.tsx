import { useEffect, useRef, useState } from "react";

interface Props {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}

export default function PromptModal({
  title,
  label,
  initialValue = "",
  confirmLabel = "Valider",
  busy = false,
  error,
  onCancel,
  onSubmit,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(value);
        }}
      >
        <h3>{title}</h3>
        <label className="modal__label">
          {label}
          <input ref={inputRef} type="text" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
        </label>
        {error && <p className="modal__error">{error}</p>}
        <div className="modal__actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Annuler
          </button>
          <button type="submit" className="active" disabled={busy}>
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
