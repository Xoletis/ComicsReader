import { RecentFile } from "../lib/recentFiles";
import { ShortcutOverrides } from "../lib/shortcuts";
import FileDropZone from "./FileDropZone";
import Library from "./Library";

interface Props {
  onFile: (file: File) => void;
  error: string | null;
  libraryRefreshSignal: number;
  onOpenSettings: () => void;
  onOpenBookmarksOverview: () => void;
  onOpenStats: () => void;
  shortcutOverrides: ShortcutOverrides;
  active: boolean;
  recentFiles: RecentFile[];
  onOpenRecent: (entry: RecentFile) => void;
  onRemoveRecent: (entry: RecentFile) => void;
  onClearRecent: () => void;
}

export default function Home({
  onFile,
  error,
  libraryRefreshSignal,
  onOpenSettings,
  onOpenBookmarksOverview,
  onOpenStats,
  shortcutOverrides,
  active,
  recentFiles,
  onOpenRecent,
  onRemoveRecent,
  onClearRecent,
}: Props) {
  return (
    <div className="home">
      <FileDropZone
        onFile={onFile}
        error={error}
        recentFiles={recentFiles}
        onOpenRecent={onOpenRecent}
        onRemoveRecent={onRemoveRecent}
        onClearRecent={onClearRecent}
      />
      <Library
        onOpenFile={onFile}
        refreshSignal={libraryRefreshSignal}
        onOpenSettings={onOpenSettings}
        onOpenBookmarksOverview={onOpenBookmarksOverview}
        onOpenStats={onOpenStats}
        shortcutOverrides={shortcutOverrides}
        active={active}
      />
    </div>
  );
}
