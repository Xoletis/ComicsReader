import { ShortcutOverrides } from "../lib/shortcuts";
import FileDropZone from "./FileDropZone";
import Library from "./Library";

interface Props {
  onFile: (file: File) => void;
  error: string | null;
  libraryRefreshSignal: number;
  onOpenSettings: () => void;
  shortcutOverrides: ShortcutOverrides;
  active: boolean;
}

export default function Home({ onFile, error, libraryRefreshSignal, onOpenSettings, shortcutOverrides, active }: Props) {
  return (
    <div className="home">
      <FileDropZone onFile={onFile} error={error} />
      <Library
        onOpenFile={onFile}
        refreshSignal={libraryRefreshSignal}
        onOpenSettings={onOpenSettings}
        shortcutOverrides={shortcutOverrides}
        active={active}
      />
    </div>
  );
}
