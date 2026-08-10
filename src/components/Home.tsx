import FileDropZone from "./FileDropZone";
import Library from "./Library";

interface Props {
  onFile: (file: File) => void;
  error: string | null;
  libraryRefreshSignal: number;
  onOpenSettings: () => void;
}

export default function Home({ onFile, error, libraryRefreshSignal, onOpenSettings }: Props) {
  return (
    <div className="home">
      <FileDropZone onFile={onFile} error={error} />
      <Library onOpenFile={onFile} refreshSignal={libraryRefreshSignal} onOpenSettings={onOpenSettings} />
    </div>
  );
}
