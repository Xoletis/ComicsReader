import { useCallback, useRef, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  error: string | null;
}

export default function FileDropZone({ onFile, error }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  return (
    <div
      className={`drop-zone ${dragging ? "drop-zone--active" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="drop-zone__content">
        <h1>
          CBReader <span className="drop-zone__version">v{import.meta.env.VITE_APP_VERSION}</span>
        </h1>
        <p>Glissez-déposez un fichier .cbz ou .cbr ici</p>
        <button type="button" onClick={() => inputRef.current?.click()}>
          Choisir un fichier
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".cbz,.zip,.cbr,.rar"
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        {error && <p className="drop-zone__error">{error}</p>}
      </div>
    </div>
  );
}
