import { useRef, useState } from "react";
import type { FileInfo } from "../../api/evidence-client";
import { useToast } from "../ui/ToastProvider";

interface Props {
  label: string;
  accept: string;
  hint: string;
  files: FileInfo[];
  onUpload: (file: File) => Promise<void>;
  onDelete: (filename: string) => Promise<void>;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function FileUploader({ label, accept, hint, files, onUpload, onDelete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const toast = useToast();

  async function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    for (const f of Array.from(fileList)) {
      try {
        await onUpload(f);
        toast.success(`已上传 ${f.name}`);
      } catch (e) {
        toast.error(`上传 ${f.name} 失败：${String(e)}`);
      }
    }
  }

  async function handleDelete(filename: string) {
    if (!window.confirm(`删除 ${filename}?`)) return;
    try {
      await onDelete(filename);
      toast.success(`已删除 ${filename}`);
    } catch (e) {
      toast.error(`删除 ${filename} 失败：${String(e)}`);
    }
  }

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold">{label} ({files.length})</h4>
      <div
        className={`border-2 border-dashed p-4 rounded text-xs text-[var(--meta)] cursor-pointer ${dragOver ? "border-[var(--accent)] bg-[var(--accent-fill)]" : "border-[var(--hair)]"}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        拖拽文件到这里或点击选择 · {hint}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {files.length > 0 && (
        <ul className="text-xs space-y-1">
          {files.map((f) => (
            <li key={f.filename} className="flex items-center justify-between border px-2 py-1 rounded">
              <span className="truncate">{f.filename}</span>
              <span className="text-[var(--meta)] ml-2">{fmtSize(f.size)}</span>
              <button
                onClick={() => handleDelete(f.filename)}
                aria-label={`delete ${f.filename}`}
                className="ml-2 text-[var(--red)] text-xs"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
