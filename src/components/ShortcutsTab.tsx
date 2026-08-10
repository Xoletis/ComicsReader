import { useEffect, useMemo, useState } from "react";
import {
  comboFromEvent,
  effectiveBinding,
  loadShortcutOverrides,
  saveShortcutOverrides,
  SHORTCUT_ACTIONS,
  ShortcutOverrides,
  stripComboFromOverrides,
} from "../lib/shortcuts";

interface Props {
  onChange: (overrides: ShortcutOverrides) => void;
  onCapturingChange: (capturing: boolean) => void;
}

type Section = "primary" | "secondary";

// The "Raccourcis" tab of SettingsModal — lets the user browse every
// keyboard-triggerable action (grouped by category, left) and reassign its
// primary/secondary key combos (right). See lib/shortcuts.ts for the model.
export default function ShortcutsTab({ onChange, onCapturingChange }: Props) {
  const [overrides, setOverrides] = useState<ShortcutOverrides>(() => loadShortcutOverrides());
  const [selectedId, setSelectedId] = useState(SHORTCUT_ACTIONS[0].id);
  const [selectedSecondary, setSelectedSecondary] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("primary");
  const [listening, setListening] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    onCapturingChange(listening);
  }, [listening, onCapturingChange]);

  const categories = useMemo(() => {
    const order: string[] = [];
    const byCategory = new Map<string, typeof SHORTCUT_ACTIONS>();
    for (const action of SHORTCUT_ACTIONS) {
      if (!byCategory.has(action.category)) {
        byCategory.set(action.category, []);
        order.push(action.category);
      }
      byCategory.get(action.category)!.push(action);
    }
    return order.map((name) => ({ name, actions: byCategory.get(name)! }));
  }, []);

  const selectedAction = SHORTCUT_ACTIONS.find((a) => a.id === selectedId)!;
  const selectedBinding = effectiveBinding(overrides, selectedId);

  const commit = (next: ShortcutOverrides) => {
    setOverrides(next);
    saveShortcutOverrides(next);
    onChange(next);
  };

  const assignCombo = (combo: string) => {
    const stripped = stripComboFromOverrides(overrides, combo, selectedId);
    const current = effectiveBinding(stripped, selectedId);
    const next: ShortcutOverrides = { ...stripped };
    if (activeSection === "primary") {
      next[selectedId] = { primary: combo, secondary: current.secondary };
    } else {
      if (current.secondary.includes(combo)) return; // already there, nothing to do
      next[selectedId] = { primary: current.primary, secondary: [...current.secondary, combo] };
    }
    commit(next);
  };

  const clearPrimary = () => {
    commit({ ...overrides, [selectedId]: { primary: null, secondary: selectedBinding.secondary } });
  };

  const removeSelectedSecondary = () => {
    if (!selectedSecondary) return;
    commit({
      ...overrides,
      [selectedId]: { primary: selectedBinding.primary, secondary: selectedBinding.secondary.filter((c) => c !== selectedSecondary) },
    });
    setSelectedSecondary(null);
  };

  const resetAll = () => commit({});

  // Captures the next key combo for whichever field (primary/secondary) was
  // last focused. Escape cancels the capture instead of being assignable —
  // same convention as most keybinding UIs (games, editors...). Also reported
  // up via onCapturingChange so the parent modal can suspend its own
  // Escape-to-close handling while a capture is in progress.
  useEffect(() => {
    if (!listening) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setListening(false);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // a bare modifier key alone isn't a full combo yet
      assignCombo(combo);
      setListening(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listening]);

  const toggleCategory = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <>
      <div className="shortcuts-editor">
        <div className="shortcuts-tree">
          {categories.map(({ name, actions }) => {
            const isCollapsed = collapsed.has(name);
            return (
              <div key={name} className="shortcuts-tree__category">
                <button type="button" className="shortcuts-tree__category-header" onClick={() => toggleCategory(name)}>
                  <span className="shortcuts-tree__chevron">{isCollapsed ? "▸" : "▾"}</span>
                  {name}
                </button>
                {!isCollapsed &&
                  actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className={`shortcuts-tree__action${action.id === selectedId ? " active" : ""}`}
                      onClick={() => {
                        setSelectedId(action.id);
                        setSelectedSecondary(null);
                        setActiveSection("primary");
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>

        <div className="shortcuts-detail">
          <h3>{selectedAction.label}</h3>

          <label className="shortcuts-detail__label">Raccourci</label>
          <div className="shortcuts-detail__row">
            <button
              type="button"
              className={`shortcuts-detail__field${activeSection === "primary" ? " active" : ""}`}
              onClick={() => setActiveSection("primary")}
            >
              {selectedBinding.primary ?? "—"}
            </button>
            <button type="button" className="shortcuts-detail__clear" onClick={clearPrimary} title="Effacer" aria-label="Effacer">
              ≪
            </button>
          </div>

          <button
            type="button"
            className={`shortcuts-detail__assistant${listening ? " active" : ""}`}
            onClick={() => setListening(true)}
          >
            {listening ? "Appuyez sur une touche…" : "Assistant"}
          </button>

          <label className="shortcuts-detail__label">Raccourcis secondaires</label>
          <div className="shortcuts-detail__row">
            <div
              className={`shortcuts-detail__list${activeSection === "secondary" ? " active" : ""}`}
              onClick={() => setActiveSection("secondary")}
            >
              {selectedBinding.secondary.length === 0 && <div className="shortcuts-detail__list-empty">—</div>}
              {selectedBinding.secondary.map((combo) => (
                <div
                  key={combo}
                  className={`shortcuts-detail__list-item${combo === selectedSecondary ? " active" : ""}`}
                  onClick={() => {
                    setActiveSection("secondary");
                    setSelectedSecondary(combo);
                  }}
                >
                  {combo}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="shortcuts-detail__clear"
              onClick={removeSelectedSecondary}
              disabled={!selectedSecondary}
              title="Retirer"
              aria-label="Retirer"
            >
              ≪
            </button>
          </div>
        </div>
      </div>

      <div className="modal__actions">
        <button type="button" onClick={resetAll} disabled={Object.keys(overrides).length === 0}>
          Réinitialiser les raccourcis
        </button>
      </div>
    </>
  );
}
