import { useRef, useState } from "react";
import { api } from "../../api/client";
import {
  uploadBriefAttachment,
  briefAttachmentMarkdown,
  type BriefAttachmentItem,
} from "../../api/writer-client";
import { useBriefPaste } from "../../hooks/useBriefPaste";
import { useBriefDrop } from "../../hooks/useBriefDrop";

export function BriefIntakeForm({
  projectId,
  onUploaded,
}: {
  projectId: string;
  onUploaded: () => void;
}) {
  const [mode, setMode] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [productName, setProductName] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploadedItems, setUploadedItems] = useState<BriefAttachmentItem[]>([]);

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const imgInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function insertAtCaret(insert: string) {
    const el = taRef.current;
    if (!el) {
      setText((t) => t + insert);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const next = before + insert + after;
    setText(next);
    queueMicrotask(() => {
      if (el) {
        const pos = start + insert.length;
        el.focus();
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          /* ignore */
        }
      }
    });
  }

  function onAttachmentItems(items: BriefAttachmentItem[]) {
    setUploadedItems((prev) => [...prev, ...items]);
  }

  useBriefPaste(taRef, {
    projectId,
    onInsert: insertAtCaret,
    onError: (e) => setErr(e.message),
    onUploaded: onAttachmentItems,
  });
  const drop = useBriefDrop(taRef, {
    projectId,
    onInsert: insertAtCaret,
    onError: (e) => setErr(e.message),
    onUploaded: onAttachmentItems,
  });

  async function uploadPickedFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      const res = await uploadBriefAttachment(projectId, Array.from(files));
      for (const it of res.items) {
        insertAtCaret(briefAttachmentMarkdown(it, projectId) + "\n");
      }
      onAttachmentItems(res.items);
    } catch (e: any) {
      setErr(String(e.message ?? e));
    }
  }

  function removeUploaded(idx: number) {
    setUploadedItems((prev) => {
      const it = prev[idx];
      if (it) {
        const md = briefAttachmentMarkdown(it, projectId);
        setText((t) => t.split(md + "\n").join("").split(md).join(""));
      }
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "text") {
        if (!text.trim()) throw new Error("Brief 文本不能为空");
        await api.uploadBriefText(projectId, {
          text,
          productName: productName || undefined,
          productUrl: productUrl || undefined,
          notes: notes || undefined,
        });
      } else {
        if (!file) throw new Error("请选择文件");
        await api.uploadBriefFile(projectId, file, {
          productName: productName || undefined,
          productUrl: productUrl || undefined,
          notes: notes || undefined,
        });
      }
      onUploaded();
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="space-y-4 p-4 bg-white rounded border"
      style={{ borderColor: "var(--border)" }}
    >
      <h2 className="font-semibold">上传 Brief</h2>

      <div className="flex gap-2">
        <button
          onClick={() => setMode("text")}
          className={`px-3 py-1 rounded border ${
            mode === "text" ? "bg-[var(--green-light)] border-[var(--green)]" : ""
          }`}
        >
          粘贴文本
        </button>
        <button
          onClick={() => setMode("file")}
          className={`px-3 py-1 rounded border ${
            mode === "file" ? "bg-[var(--green-light)] border-[var(--green)]" : ""
          }`}
        >
          上传文件
        </button>
      </div>

      {mode === "text" ? (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <button
              type="button"
              onClick={() => imgInputRef.current?.click()}
              className="px-2 py-1 border rounded text-xs"
              aria-label="插入图片"
              data-testid="brief-image-button"
            >
              🖼 图片
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-2 py-1 border rounded text-xs"
              aria-label="插入附件"
              data-testid="brief-file-button"
            >
              📎 附件
            </button>
            <span className="text-xs text-gray-500">
              支持粘贴 (Cmd+V) / 拖拽到下方文本框
            </span>
          </div>
          <input
            ref={imgInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            data-testid="brief-image-input"
            onChange={(e) => {
              void uploadPickedFiles(e.target.files);
              if (imgInputRef.current) imgInputRef.current.value = "";
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.zip,application/pdf,application/zip,text/*"
            multiple
            style={{ display: "none" }}
            data-testid="brief-file-input"
            onChange={(e) => {
              void uploadPickedFiles(e.target.files);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <div className="relative">
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              className="w-full border rounded p-2"
              placeholder="粘贴 Brief 原文…  支持 Cmd+V 粘贴图片/文件、拖拽上传"
              data-testid="brief-textarea"
            />
            {drop.isDragging && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-[var(--green-light)] bg-opacity-70 border-2 border-dashed border-[var(--green)] rounded pointer-events-none text-sm font-medium"
                data-testid="brief-drop-overlay"
              >
                拖拽到此上传
              </div>
            )}
            {drop.uploading && (
              <div className="text-xs text-gray-500 mt-1" data-testid="brief-upload-progress">
                上传中 {drop.uploadDone}/{drop.uploadTotal}
              </div>
            )}
          </div>
          {uploadedItems.length > 0 && (
            <ul className="space-y-1" data-testid="brief-attachment-list">
              {uploadedItems.map((it, i) => (
                <li
                  key={`${it.url}-${i}`}
                  className="flex items-center gap-2 text-xs border rounded px-2 py-1"
                >
                  <span>{it.kind === "image" ? "🖼" : "📎"}</span>
                  <span className="flex-1 truncate">{it.filename}</span>
                  <span className="text-gray-400">{Math.round(it.size / 1024)}KB</span>
                  <button
                    type="button"
                    onClick={() => removeUploaded(i)}
                    className="text-red-500"
                    aria-label={`删除 ${it.filename}`}
                  >
                    x删除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <input
          type="file"
          accept=".docx,.pdf,.md,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      )}

      <div className="space-y-2">
        <label className="block text-sm">产品名（可选）</label>
        <input
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          className="w-full border rounded p-2"
        />
        <label className="block text-sm mt-2">产品官网 URL（可选）</label>
        <input
          value={productUrl}
          onChange={(e) => setProductUrl(e.target.value)}
          className="w-full border rounded p-2"
        />
        <label className="block text-sm mt-2">备注（可选）</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full border rounded p-2"
        />
      </div>

      {err && <div className="text-red-600 text-sm">{err}</div>}

      <button
        onClick={submit}
        disabled={busy}
        className="px-4 py-2 rounded text-white"
        style={{ background: "var(--green)" }}
      >
        {busy ? "上传中…" : "开始解析 Brief"}
      </button>
    </div>
  );
}
