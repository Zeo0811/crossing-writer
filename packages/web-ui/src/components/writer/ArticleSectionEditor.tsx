import { useRef, useState } from "react";
import { ImageUploadButton } from "./ImageUploadButton";
import { useImageDrop } from "../../hooks/useImageDrop";

export interface ArticleSectionEditorProps {
  initialBody: string;
  disabled?: boolean;
  onSave: (body: string) => void | Promise<void>;
  onCancel: () => void;
  projectId: string;
  sectionKey: string;
}

export function ArticleSectionEditor({
  initialBody,
  disabled,
  onSave,
  onCancel,
  projectId,
}: ArticleSectionEditorProps) {
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const insertAtCaret = (text: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setBody((b) => b + text);
      return;
    }
    const s = ta.selectionStart ?? body.length;
    const e = ta.selectionEnd ?? body.length;
    const next = body.slice(0, s) + text + body.slice(e);
    setBody(next);
    setTimeout(() => {
      try {
        ta.focus();
        const caret = s + text.length;
        ta.setSelectionRange(caret, caret);
      } catch { /* ignore */ }
    }, 0);
  };

  const { isDragging, uploading, uploadTotal, uploadDone } = useImageDrop(containerRef, {
    projectId,
    onInsert: (md) => insertAtCaret(md),
    onError: (err) => setError(err.message),
  });

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(body);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  };

  const showOverlay = isDragging || uploading;

  return (
    <div
      ref={containerRef}
      data-testid="section-editor-container"
      style={{ position: "relative" }}
      className="flex flex-col gap-2"
    >
      <div className="flex gap-2 items-center">
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled || saving}
          className="px-2 py-1 bg-blue-600 text-white rounded text-xs disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-2 py-1 bg-gray-200 rounded text-xs"
        >
          取消
        </button>
        <ImageUploadButton
          projectId={projectId}
          disabled={disabled || saving}
          onInsert={(md) => insertAtCaret(md)}
          onError={(err) => setError(err.message)}
        />
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={disabled}
        rows={12}
        style={{ minHeight: 200, width: "100%", fontFamily: "monospace" }}
        className="border rounded p-2 text-sm"
      />
      {showOverlay && (
        <div
          data-testid="drop-overlay"
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(59,130,246,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            fontSize: 14,
            color: "var(--accent)",
          }}
        >
          {uploading
            ? `上传中... ${uploadDone}/${uploadTotal}`
            : "拖到这里上传"}
        </div>
      )}
    </div>
  );
}
