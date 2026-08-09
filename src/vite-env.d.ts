/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Not yet in @types/wicg-file-system-access (2023.10.7) — added later to the
// File System Access API spec for in-place rename/move without a data copy.
interface FileSystemHandle {
  move?(newParentOrName: FileSystemDirectoryHandle | string, newName?: string): Promise<void>;
}
