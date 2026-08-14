import { useEffect, useState } from "react";
import { COMFORT_FILTERS, ComfortFilterId } from "../lib/comfortFilter";
import { applyTheme, saveActiveTheme } from "../lib/theme";
import { BUILT_IN_THEMES, ThemeFile } from "../lib/themeFile";
import { getThemesFolderLocation, isThemesFolderSupported, loadThemesFromFolder } from "../lib/themesFileStore";

interface Props {
  theme: ThemeFile;
  onChange: (theme: ThemeFile) => void;
  comfortFilter: ComfortFilterId;
  onComfortFilterChange: (id: ComfortFilterId) => void;
}

// The "Apparence" tab of SettingsModal: pick a theme from the themes/ folder,
// created automatically on first launch (see lib/themesFileStore.ts) and
// seeded with one file per built-in theme — dropping in another .json file
// with the same shape (or editing one of the existing ones) is how a user
// customizes or creates a theme. No in-app picker: the app always knows
// where this folder is. Not available in the plain web build, which has no
// legitimate way to write files to a fixed location without a user gesture
// each time — it just shows the bundled built-ins with no folder at all.
export default function AppearanceTab({ theme, onChange, comfortFilter, onComfortFilterChange }: Props) {
  const supported = isThemesFolderSupported();
  const [themes, setThemes] = useState<ThemeFile[]>(BUILT_IN_THEMES);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    setThemes(await loadThemesFromFolder());
  };

  useEffect(() => {
    if (!supported) return;
    void refresh();
    void getThemesFolderLocation().then(setFolderPath);
  }, [supported]);

  const select = (next: ThemeFile) => {
    applyTheme(next);
    saveActiveTheme(next);
    onChange(next);
  };

  const copyPath = async () => {
    if (!folderPath) return;
    try {
      await navigator.clipboard.writeText(folderPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // presse-papiers indisponible - on ignore silencieusement
    }
  };

  const isActive = (t: ThemeFile) => t.id === theme.id && t.name === theme.name;

  return (
    <div className="appearance-tab">
      <label className="shortcuts-detail__label">Thèmes</label>
      <div className="appearance-tab__options">
        {themes.map((t) => (
          <ThemeSwatch key={t.id} theme={t} active={isActive(t)} onClick={() => select(t)} />
        ))}
      </div>

      <label className="shortcuts-detail__label">Filtre de confort visuel</label>
      <div className="appearance-tab__options">
        {COMFORT_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`appearance-tab__option${comfortFilter === f.id ? " active" : ""}`}
            onClick={() => onComfortFilterChange(f.id)}
          >
            <span
              className="appearance-tab__swatch"
              style={{ filter: f.filter ?? undefined, background: "linear-gradient(135deg, #e8dcc8 50%, #6b5744 50%)" }}
            />
            {f.label}
          </button>
        ))}
      </div>
      <p className="appearance-tab__hint">S'applique à l'image de la page dans le lecteur, indépendamment du thème.</p>

      {supported ? (
        <>
          <label className="shortcuts-detail__label">Dossier de thèmes</label>
          {folderPath && (
            <div className="info-list__location">
              <span className="info-list__path" title={folderPath}>
                {folderPath}
              </span>
              <button type="button" onClick={copyPath}>
                {copied ? "Copié !" : "Copier"}
              </button>
            </div>
          )}
          <p className="appearance-tab__hint">
            Un fichier .json par thème. Ouvre-en un avec un éditeur de texte pour le modifier, ou ajoutes-en un
            nouveau (même format) pour créer un thème — n'importe qui peut en ajouter autant qu'il veut. Reviens ici
            et clique sur "Actualiser" après avoir enregistré.
          </p>
          <button type="button" onClick={refresh}>
            Actualiser
          </button>
        </>
      ) : (
        <p className="appearance-tab__hint">
          La personnalisation par fichier n'est disponible que dans l'application de bureau.
        </p>
      )}
    </div>
  );
}

function ThemeSwatch({ theme, active, onClick }: { theme: ThemeFile; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`appearance-tab__option${active ? " active" : ""}`} onClick={onClick}>
      <span
        className="appearance-tab__swatch"
        style={{ background: `linear-gradient(135deg, ${theme.colors.bg} 50%, ${theme.colors.accent} 50%)` }}
      />
      {theme.name}
    </button>
  );
}
