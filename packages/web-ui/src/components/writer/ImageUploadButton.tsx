import { useRef, useState } from "react";
import { uploadImage } from "../../api/writer-client";

export interface ImageUploadButtonProps {
  projectId: string;
  onInsert: (markdown: string) => void;
  onError?: (err: Error) => void;
  disabled?: boolean;
}

export function ImageUploadButton({ projectId, onInsert, onError, disabled }: ImageUploadButtonProps) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const res = await uploadImage(projectId, file);
      onInsert(`![${file.name}](${res.url})`);
    } catch (err: any) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => ref.current?.click()}
        className="px-2 py-1 border rounded text-xs disabled:opacity-50"
        aria-label="插图"
      >
        {busy ? "上传中..." : "📷 插图"}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleChange}
        data-testid="image-upload-input"
      />
    </>
  );
}
