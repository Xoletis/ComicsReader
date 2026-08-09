import { useCallback, useEffect, useState } from "react";
import { ComicEntry, FolderEntry, listEntries } from "../lib/library";
import FolderIcon from "./FolderIcon";
import { PathEntry } from "./MoveFolderModal";

interface Props {
  entry: FolderEntry;
  depth: number;
  pathEntries: PathEntry[];
  activePathKey: string;
  folderColors: Record<string, string>;
  onNavigate: (pathEntries: PathEntry[]) => void;
  onOpenComic: (entry: ComicEntry) => void;
}

export default function LibraryTreeNode({
  entry,
  depth,
  pathEntries,
  activePathKey,
  folderColors,
  onNavigate,
  onOpenComic,
}: Props) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [children, setChildren] = useState<{ folders: FolderEntry[]; comics: ComicEntry[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const isActive = pathEntries.map((p) => p.name).join("/") === activePathKey;
  const colorKey = pathEntries
    .slice(1)
    .map((p) => p.name)
    .join("/");
  const color = folderColors[colorKey];

  const loadChildren = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listEntries(entry.handle);
      setChildren(result);
    } catch {
      setChildren({ folders: [], comics: [] });
    } finally {
      setLoading(false);
    }
  }, [entry.handle]);

  useEffect(() => {
    if (depth === 0) void loadChildren();
    // Only the root auto-loads on mount; deeper nodes load lazily on first expand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!expanded && children === null) void loadChildren();
    setExpanded((prev) => !prev);
  };

  return (
    <div className="library-tree__node">
      <button
        type="button"
        className={`library-tree__row ${isActive ? "library-tree__row--active" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => onNavigate(pathEntries)}
        title={entry.name}
      >
        <span className="library-tree__chevron" onClick={handleToggle}>
          {loading ? "…" : expanded ? "▾" : "▸"}
        </span>
        <FolderIcon color={color} className="library-tree__folder-icon" />
        <span className="library-tree__label">{entry.name}</span>
      </button>

      {expanded && children && (
        <div className="library-tree__children">
          {children.folders.map((folder) => (
            <LibraryTreeNode
              key={folder.name}
              entry={folder}
              depth={depth + 1}
              pathEntries={[...pathEntries, folder]}
              activePathKey={activePathKey}
              folderColors={folderColors}
              onNavigate={onNavigate}
              onOpenComic={onOpenComic}
            />
          ))}
          {children.comics.map((comic) => (
            <button
              type="button"
              key={comic.name}
              className="library-tree__row library-tree__row--comic"
              style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}
              onClick={() => onOpenComic(comic)}
              title={comic.name}
            >
              <span className="library-tree__chevron" />
              <span className="library-tree__comic-icon">📕</span>
              <span className="library-tree__label">{comic.name}</span>
            </button>
          ))}
          {children.folders.length === 0 && children.comics.length === 0 && (
            <p className="library-tree__empty" style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}>
              Vide
            </p>
          )}
        </div>
      )}
    </div>
  );
}
