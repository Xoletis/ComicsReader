import { useCallback, useEffect, useState } from "react";
import { isFileSystemAccessSupported } from "../lib/library";
import { applyTheme, saveActiveTheme } from "../lib/theme";
import { BUILT_IN_THEMES, ThemeFile } from "../lib/themeFile";
import {
  clearThemesDirectoryHandle,
  loadThemesDirectoryHandle,
  pickThemesFolder,
  queryThemesFolderPermission,
  requestThemesFolderPermission,
  scanThemesFolder,
} from "../lib/themeFolder";

type FolderStatus = "checking" | "unsupported" | "disconnected" | "needs-permission" | "connected";

interface Props {
  theme: ThemeFile;
  onChange: (theme: ThemeFile) => void;
}

// The "Apparence" tab of SettingsModal: pick from the built-in themes, or
// connect a folder of custom theme .json files (same format, hand-authored
// by the user or copied in from anywhere) — every .json file directly inside
// is auto-detected on connect/refresh, no per-file import step.
export default function AppearanceTab({ theme, onChange }: Props) {
  const [folderStatus, setFolderStatus] = useState<FolderStatus>("checking");
  const [folderHandle, setFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [folderThemes, setFolderThemes] = useState<ThemeFile[]>([]);
  const [folderError, setFolderError] = useState<string | null>(null);

  const scan = useCallback(async (handle: FileSystemDirectoryHandle) => {
    try {
      setFolderThemes(await scanThemesFolder(handle));
      setFolderError(null);
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : "Impossible de lire ce dossier.");
    }
  }, []);

  useEffect(() => {
    if (!isFileSystemAccessSupported()) {
      setFolderStatus("unsupported");
      return;
    }
    (async () => {
      const handle = await loadThemesDirectoryHandle();
      if (!handle) {
        setFolderStatus("disconnected");
        return;
      }
      setFolderHandle(handle);
      const permission = await queryThemesFolderPermission(handle);
      if (permission === "granted") {
        setFolderStatus("connected");
        await scan(handle);
      } else {
        setFolderStatus("needs-permission");
      }
    })();
  }, [scan]);

  const connectFolder = useCallback(async () => {
    try {
      const handle = await pickThemesFolder();
      setFolderHandle(handle);
      setFolderStatus("connected");
      await scan(handle);
    } catch {
      // picker cancelled — leave status as-is
    }
  }, [scan]);

  const reconnectFolder = useCallback(async () => {
    if (!folderHandle) return;
    const permission = await requestThemesFolderPermission(folderHandle);
    if (permission === "granted") {
      setFolderStatus("connected");
      await scan(folderHandle);
    }
  }, [folderHandle, scan]);

  const disconnectFolder = useCallback(async () => {
    await clearThemesDirectoryHandle();
    setFolderHandle(null);
    setFolderThemes([]);
    setFolderStatus("disconnected");
  }, []);

  const refresh = useCallback(() => {
    if (folderHandle) void scan(folderHandle);
  }, [folderHandle, scan]);

  const select = (next: ThemeFile) => {
    applyTheme(next);
    saveActiveTheme(next);
    onChange(next);
  };

  const isActive = (t: ThemeFile) => t.id === theme.id && t.name === theme.name;

  return (
    <div className="appearance-tab">
      <label className="shortcuts-detail__label">Thèmes intégrés</label>
      <div className="appearance-tab__options">
        {BUILT_IN_THEMES.map((t) => (
          <ThemeSwatch key={t.id} theme={t} active={isActive(t)} onClick={() => select(t)} />
        ))}
      </div>

      <label className="shortcuts-detail__label">Dossier de thèmes personnalisés</label>
      {folderStatus === "unsupported" && (
        <p className="appearance-tab__hint">
          Non disponible sur ce navigateur (nécessite Chrome, Edge...). Copiez vos thèmes dans{" "}
          <code>src/themes/</code> à la place.
        </p>
      )}
      {folderStatus === "checking" && <p className="appearance-tab__hint">Vérification…</p>}
      {folderStatus === "disconnected" && (
        <button type="button" onClick={connectFolder}>
          Connecter un dossier de thèmes…
        </button>
      )}
      {folderStatus === "needs-permission" && (
        <button type="button" onClick={reconnectFolder}>
          Reconnecter le dossier de thèmes
        </button>
      )}
      {folderStatus === "connected" && (
        <>
          <div className="appearance-tab__folder-controls">
            <button type="button" onClick={refresh}>
              Actualiser
            </button>
            <button type="button" onClick={connectFolder}>
              Changer de dossier
            </button>
            <button type="button" onClick={disconnectFolder}>
              Déconnecter
            </button>
          </div>
          {folderError && <p className="modal__error">{folderError}</p>}
          {folderThemes.length === 0 && !folderError && (
            <p className="appearance-tab__hint">Aucun fichier .json de thème trouvé dans ce dossier.</p>
          )}
          {folderThemes.length > 0 && (
            <div className="appearance-tab__options">
              {folderThemes.map((t) => (
                <ThemeSwatch key={t.id} theme={t} active={isActive(t)} onClick={() => select(t)} />
              ))}
            </div>
          )}
        </>
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
