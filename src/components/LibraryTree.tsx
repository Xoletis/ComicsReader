import { ComicEntry, FolderEntry } from "../lib/library";
import LibraryTreeNode from "./LibraryTreeNode";
import { PathEntry } from "./MoveFolderModal";

interface Props {
  rootHandle: FileSystemDirectoryHandle;
  rootName: string;
  activePathKey: string;
  folderColors: Record<string, string>;
  onNavigate: (pathEntries: PathEntry[]) => void;
  onOpenComic: (entry: ComicEntry) => void;
  onClose: () => void;
}

export default function LibraryTree({
  rootHandle,
  rootName,
  activePathKey,
  folderColors,
  onNavigate,
  onOpenComic,
  onClose,
}: Props) {
  const rootEntry: FolderEntry = { name: rootName, handle: rootHandle };

  return (
    <aside className="library-tree">
      <div className="library-tree__header">
        <h3>Arborescence</h3>
        <button type="button" className="library-tree__close" onClick={onClose} title="Masquer l'arborescence">
          ✕
        </button>
      </div>
      <div className="library-tree__body">
        <LibraryTreeNode
          entry={rootEntry}
          depth={0}
          pathEntries={[rootEntry]}
          activePathKey={activePathKey}
          folderColors={folderColors}
          onNavigate={onNavigate}
          onOpenComic={onOpenComic}
        />
      </div>
    </aside>
  );
}
