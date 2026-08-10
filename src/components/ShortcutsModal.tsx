import { useEffect, useState } from "react";
import {
  buildKeyToActionMap,
  effectiveKey,
  formatKey,
  loadShortcutOverrides,
  saveShortcutOverrides,
  SHORTCUT_ACTIONS,
  ShortcutMap,
} from "../lib/shortcuts";

interface Props {
  onClose: () => void;
  onChange: (overrides: ShortcutMap) => void;
}

export default function ShortcutsModal({ onClose, onChange }: Props) {
  const [overrides, setOverrides] = useState<ShortcutMap>(() => loadShortcutOverrides());
  const [listeningFor, setListeningFor] = useState<string | null>(null);

  const commit = (next: ShortcutMap) => {
    setOverrides(next);
    saveShortcutOverrides(next);
    onChange(next);
  };

  // Captures the next keypress as the new binding for whichever row is being
  // reassigned. Escape cancels the capture instead of being bindable — same
  // convention as most keybinding UIs (games, editors...).
  useEffect(() => {
    if (!listeningFor) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setListeningFor(null);
        return;
      }
      // Only one action may hold a given key at a time — reassigning steals
      // it from whichever action previously had it, so no two rows ever fire
      // on the same keypress.
      const keyToAction = buildKeyToActionMap(overrides);
      const previousOwner = keyToAction.get(e.key);
      const next = { ...overrides };
      if (previousOwner && previousOwner !== listeningFor) {
        const stolenFrom = SHORTCUT_ACTIONS.find((a) => a.id === previousOwner);
        // The action losing its key falls back to having no binding at all
        // (empty string) rather than silently reverting to its default,
        // which could reintroduce a conflict with a third action.
        if (stolenFrom) next[previousOwner] = "";
      }
      next[listeningFor] = e.key;
      commit(next);
      setListeningFor(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listeningFor, overrides]);

  // Closes the modal on Escape, but only when not mid-capture (handled above).
  useEffect(() => {
    if (listeningFor) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [listeningFor, onClose]);

  const resetOne = (actionId: string) => {
    const next = { ...overrides };
    delete next[actionId];
    commit(next);
  };

  const resetAll = () => commit({});

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--shortcuts" onClick={(e) => e.stopPropagation()}>
        <h3>Raccourcis clavier</h3>
        <div className="shortcuts-list">
          {SHORTCUT_ACTIONS.map((action) => {
            const key = effectiveKey(overrides, action.id);
            const isListening = listeningFor === action.id;
            return (
              <div key={action.id} className="shortcuts-list__row">
                <span className="shortcuts-list__label">{action.label}</span>
                <button
                  type="button"
                  className={`shortcuts-list__key${isListening ? " active" : ""}`}
                  onClick={() => setListeningFor(action.id)}
                >
                  {isListening ? "Appuyez sur une touche…" : key ? formatKey(key) : "—"}
                </button>
                <button
                  type="button"
                  className="shortcuts-list__reset"
                  onClick={() => resetOne(action.id)}
                  disabled={!(action.id in overrides)}
                  title="Réinitialiser"
                  aria-label="Réinitialiser"
                >
                  ↺
                </button>
              </div>
            );
          })}
        </div>
        <div className="modal__actions">
          <button type="button" onClick={resetAll} disabled={Object.keys(overrides).length === 0}>
            Tout réinitialiser
          </button>
          <button type="button" className="active" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
