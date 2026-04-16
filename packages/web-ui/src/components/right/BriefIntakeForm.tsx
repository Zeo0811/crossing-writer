import { useEffect, useRef, useState } from "react";
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
  initialText,
  submitLabel,
  onCancel,
}: {
  projectId: string;
  onUploaded: () => void;
  initialText?: string;
  submitLabel?: string;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<"text" | "file" | "image">("text");
  const [text, setText] = useState(initialText ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [imageFiles, setImageFiles] = useState<BriefAttachmentItem[]>([]);
  const imageTabInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploadedItems, setUploadedItems] = useState<BriefAttachmentItem[]>([]);

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorInitialized = useRef(false);
  const imgInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function wrapImg(src: string, alt: string, md: string): string {
    return `<span class="img-wrap" contenteditable="false"><img src="${src}" alt="${alt}" data-md="${md.replace(/"/g, "&quot;")}" /><button type="button" class="img-del" aria-label="删除">✕</button></span>`;
  }
  // Convert markdown text to HTML with inline images
  function mdToHtml(md: string, pid: string): string {
    return md
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
        const src = url.startsWith("/api/") || url.startsWith("http") ? url : `/api/projects/${encodeURIComponent(pid)}/brief/${url}`;
        return wrapImg(src, alt, `![${alt}](${url})`);
      })
      .replace(/\n/g, "<br/>");
  }
  // Extract text content from editor back to markdown (img → ![](url))
  function htmlToMd(root: HTMLElement): string {
    const parts: string[] = [];
    function walk(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent ?? "");
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.tagName === "IMG") {
          const md = el.getAttribute("data-md");
          if (md) { parts.push(md); return; }
          const src = el.getAttribute("src") ?? "";
          const alt = el.getAttribute("alt") ?? "";
          parts.push(`![${alt}](${src})`);
          return;
        }
        // Skip image-delete buttons so their ✕ label doesn't leak into markdown
        if (el.tagName === "BUTTON") return;
        if (el.tagName === "BR") { parts.push("\n"); return; }
        if (el.tagName === "DIV" || el.tagName === "P") {
          if (parts.length > 0 && !parts[parts.length - 1]!.endsWith("\n")) parts.push("\n");
          for (const c of Array.from(el.childNodes)) walk(c);
          return;
        }
        for (const c of Array.from(el.childNodes)) walk(c);
      }
    }
    for (const c of Array.from(root.childNodes)) walk(c);
    return parts.join("").replace(/\n+$/, "");
  }

  function insertAtCaret(insert: string) {
    const el = taRef.current;
    if (!el) { setText((t) => t + insert); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + insert + el.value.slice(end);
    setText(next);
    queueMicrotask(() => {
      if (el) {
        const pos = start + insert.length;
        el.focus();
        try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
      }
    });
  }

  function onAttachmentItems(items: BriefAttachmentItem[]) {
    setUploadedItems((prev) => [...prev, ...items]);
  }

  useBriefPaste(taRef, {
    projectId, onInsert: insertAtCaret,
    onError: (e) => setErr(e.message),
    onUploaded: onAttachmentItems,
  });
  const drop = useBriefDrop(editorRef as any, {
    projectId, onInsert: insertAtCaret,
    onError: (e) => setErr(e.message),
    onUploaded: onAttachmentItems,
  });

  // When switching to text mode, rehydrate editor from `text` state (editor DOM remounted due to key={mode})
  useEffect(() => {
    if (mode !== "text") {
      editorInitialized.current = false;
      return;
    }
    if (editorRef.current && !editorInitialized.current) {
      editorRef.current.innerHTML = mdToHtml(text, projectId);
      editorInitialized.current = true;
    }
  }, [mode, text, projectId]);

  async function uploadPickedFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      const res = await uploadBriefAttachment(projectId, Array.from(files));
      for (const it of res.items) insertAtCaret(briefAttachmentMarkdown(it, projectId) + "\n");
      onAttachmentItems(res.items);
    } catch (e: any) { setErr(String(e.message ?? e)); }
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
        if (!text.trim()) throw new Error("简报文本不能为空");
        await api.uploadBriefText(projectId, { text });
      } else if (mode === "image") {
        if (imageFiles.length === 0) throw new Error("请选择图片");
        const md = imageFiles
          .map((it) => `![${it.filename}](${it.url})`)
          .join("\n\n");
        await api.uploadBriefText(projectId, { text: md });
      } else {
        if (files.length === 0) throw new Error("请选择文件");
        for (const f of files) {
          await api.uploadBriefFile(projectId, f, {});
        }
      }
      onUploaded();
    } catch (e: any) { setErr(String(e.message ?? e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 border-b border-[var(--hair)]">
        {(["text", "file", "image"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
              mode === k ? "border-[var(--accent)] text-[var(--heading)]" : "border-transparent text-[var(--meta)] hover:text-[var(--heading)]"
            }`}
          >
            {k === "text" ? "文字" : k === "file" ? "文件" : "图片"}
          </button>
        ))}
      </div>

      <div key={mode} className="rounded border border-[var(--hair)] bg-[var(--bg-1)] h-[420px] flex flex-col overflow-hidden isolate">
        {mode === "text" ? (
          <>
            <div className="relative flex-1 min-h-0 overflow-hidden">
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                data-placeholder="把甲方简报粘贴进来…（支持 Cmd+V 粘贴图片 / 拖拽上传）"
                className="brief-editor absolute inset-0 bg-transparent p-3 text-sm text-[var(--body)] outline-none overflow-y-auto whitespace-pre-wrap break-words"
                data-testid="brief-textarea"
                onInput={(e) => setText(htmlToMd(e.currentTarget))}
                onPaste={async (e) => {
                  const cd = e.clipboardData;
                  if (!cd) return;
                  const files: File[] = [];
                  const items = cd.items ? Array.from(cd.items) : [];
                  for (const item of items) {
                    if (item.kind === "file") {
                      const f = item.getAsFile();
                      if (f) files.push(f);
                    }
                  }
                  if (files.length === 0 && cd.files && cd.files.length > 0) {
                    for (const f of Array.from(cd.files)) files.push(f);
                  }
                  if (files.length > 0) {
                    e.preventDefault();
                    try {
                      const res = await uploadBriefAttachment(projectId, files);
                      for (const it of res.items) {
                        if (it.kind === "image") {
                          const src = `/api/projects/${encodeURIComponent(projectId)}/brief/${it.url}`;
                          const md = briefAttachmentMarkdown(it, projectId);
                          document.execCommand("insertHTML", false, wrapImg(src, it.filename, md));
                        } else {
                          document.execCommand("insertText", false, briefAttachmentMarkdown(it, projectId) + "\n");
                        }
                      }
                      if (editorRef.current) setText(htmlToMd(editorRef.current));
                      onAttachmentItems(res.items);
                    } catch (err: any) { setErr(String(err?.message ?? err)); }
                    return;
                  }
                  // Plain text paste — strip formatting
                  const pasteText = cd.getData("text/plain");
                  if (pasteText) {
                    e.preventDefault();
                    document.execCommand("insertText", false, pasteText);
                  }
                }}
              />
              <style>{`
                .brief-editor:empty::before { content: attr(data-placeholder); color: var(--faint); pointer-events: none; }
                .brief-editor .img-wrap { position: relative; display: inline-block; margin: 2px; vertical-align: middle; }
                .brief-editor .img-wrap img { max-width: 240px; max-height: 200px; border-radius: 4px; display: block; user-select: none; }
                .brief-editor .img-del { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%; background: rgba(0,0,0,0.6); color: white; border: 0; font-size: 11px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 0.15s; display: flex; align-items: center; justify-content: center; }
                .brief-editor .img-wrap:hover .img-del { opacity: 1; }
                .brief-editor .img-del:hover { background: var(--red); }
              `}</style>
              {drop.isDragging && (
                <div
                  className="absolute inset-0 flex items-center justify-center bg-[var(--accent-fill)] border-2 border-dashed border-[var(--accent)] rounded pointer-events-none text-sm text-[var(--accent)] font-medium"
                  data-testid="brief-drop-overlay"
                >
                  拖拽到此上传
                </div>
              )}
              {drop.uploading && (
                <div className="absolute bottom-2 right-3 text-xs text-[var(--meta)]" data-testid="brief-upload-progress">
                  上传中 {drop.uploadDone}/{drop.uploadTotal}
                </div>
              )}
            </div>
            {uploadedItems.some((it) => it.kind !== "image") && (
              <div className="border-t border-[var(--hair)] p-2" data-testid="brief-attachment-list">
                <div className="flex flex-wrap gap-2">
                  {uploadedItems.map((it, i) => {
                    if (it.kind === "image") return null;
                    return (
                      <div key={`${it.url}-${i}`} className="flex items-center gap-2 text-xs px-2.5 h-7 rounded bg-[var(--bg-2)]">
                        <span>📎</span>
                        <span className="truncate max-w-[160px] text-[var(--body)]">{it.filename}</span>
                        <span className="text-[var(--faint)]">{Math.round(it.size / 1024)}KB</span>
                        <button
                          type="button"
                          onClick={() => removeUploaded(i)}
                          className="text-[var(--meta)] hover:text-[var(--red)]"
                          aria-label={`删除 ${it.filename}`}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="px-3 py-2 border-t border-[var(--hair)] text-xs text-[var(--faint)]">
              {text.length} 字
            </div>
          </>
        ) : mode === "file" ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-[var(--bg-2)] overflow-hidden"
            >
              <span className="text-3xl text-[var(--accent)]">⇣</span>
              <span className="text-sm text-[var(--body)]">拖入 .pdf / .docx / .md / .txt，可批量</span>
              <span className="text-xs text-[var(--faint)]">支持拖拽 · 点击选择</span>
              <input
                ref={fileInputRef}
                type="file" accept=".docx,.pdf,.md,.txt" multiple hidden
                onChange={(e) => {
                  if (!e.target.files?.length) return;
                  setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
            </div>
            {files.length > 0 && (
              <div className="border-t border-[var(--hair)] p-3 space-y-1.5 overflow-y-auto max-h-[200px]">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--bg-2)] text-sm">
                    <span className="text-[var(--accent)]">📄</span>
                    <span className="flex-1 truncate text-[var(--body)]">{f.name}</span>
                    <span className="text-xs text-[var(--faint)]">{(f.size / 1024).toFixed(1)} KB</span>
                    <button
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="text-[var(--meta)] hover:text-[var(--red)]"
                      aria-label={`删除 ${f.name}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div
              onClick={() => imageTabInputRef.current?.click()}
              className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-[var(--bg-2)] overflow-hidden"
            >
              <span className="text-3xl text-[var(--accent)]">⇣</span>
              <span className="text-sm text-[var(--body)]">拖入截图，可批量</span>
              <span className="text-xs text-[var(--faint)]">支持拖拽 · 点击选择 · Cmd+V 粘贴</span>
              <input
                ref={imageTabInputRef}
                data-testid="brief-image-tab-input"
                type="file" accept="image/*" multiple hidden
                onChange={async (e) => {
                  if (!e.target.files?.length) return;
                  try {
                    const res = await uploadBriefAttachment(projectId, Array.from(e.target.files));
                    setImageFiles((prev) => [...prev, ...res.items.filter((i) => i.kind === "image")]);
                  } catch (err: any) { setErr(String(err.message ?? err)); }
                  if (imageTabInputRef.current) imageTabInputRef.current.value = "";
                }}
              />
            </div>
            {imageFiles.length > 0 && (
              <div className="border-t border-[var(--hair)] p-3 grid grid-cols-6 md:grid-cols-8 gap-2 overflow-y-auto max-h-[240px]">
                {imageFiles.map((f, i) => (
                  <div key={`${f.url}-${i}`} className="relative group rounded bg-[var(--bg-2)] overflow-hidden aspect-square">
                    <img
                      src={`/api/projects/${encodeURIComponent(projectId)}/brief/${f.url}`}
                      alt={f.filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <button
                      onClick={() => setImageFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute top-1 right-1 w-5 h-5 rounded bg-[rgba(0,0,0,0.6)] text-white hover:bg-[var(--red)] opacity-0 group-hover:opacity-100 text-xs flex items-center justify-center"
                      title={f.filename}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {err && <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] px-3 py-2 text-sm text-[var(--red)]">{err}</div>}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2.5 text-sm text-[var(--meta)] hover:text-[var(--heading)] disabled:opacity-50"
          >
            取消
          </button>
        )}
        <button
          onClick={submit}
          disabled={busy}
          className="px-5 py-2.5 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold hover:shadow-[0_0_12px_var(--accent-dim)] disabled:opacity-50 disabled:cursor-not-allowed transition-shadow"
        >
          {busy ? "上传中…" : (submitLabel ?? "提交并解析 →")}
        </button>
      </div>
    </div>
  );
}

function Field({ label, v, set, ph }: { label: string; v: string; set: (s: string) => void; ph?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--meta)] block mb-1">{label}</span>
      <input
        value={v}
        onChange={(e) => set(e.target.value)}
        placeholder={ph}
        className="w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded px-3 py-2 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
      />
    </label>
  );
}
