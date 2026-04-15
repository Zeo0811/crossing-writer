import { useRef, useState } from "react";
import { useMock } from "../../MockProvider";

type Mode = "text" | "file" | "image";

interface UploadFile {
  name: string;
  size: number;
  kind: "doc" | "image";
}

export function BriefUpload() {
  const m = useMock();
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [productName, setProductName] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [trialUrl, setTrialUrl] = useState("");
  const [notes, setNotes] = useState("");
  const dropping = useRef(false);
  const [over, setOver] = useState(false);

  function addFiles(list: FileList | File[], kind: "doc" | "image") {
    const next: UploadFile[] = Array.from(list).map((f) => ({ name: f.name, size: f.size, kind }));
    setFiles((prev) => [...prev, ...next]);
  }

  function submit() {
    const hasContent = (mode === "text" && text.trim()) || files.length > 0;
    if (!hasContent) {
      m.pushToast({ type: "error", message: "请先填入文本或上传文件" });
      return;
    }
    m.pushToast({ type: "info", message: "正在上传 Brief…" });
    m.setHeroStatus("brief_uploaded");
    setTimeout(() => {
      m.setHeroStatus("brief_analyzing");
      setTimeout(() => {
        m.setHeroStatus("brief_ready");
        m.pushToast({ type: "success", message: "Brief 解析完成" });
      }, 1800);
    }, 800);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 border-b border-[var(--hair)]">
        {(["text", "file", "image"] as Mode[]).map((k) => {
          const label = k === "text" ? "文字" : k === "file" ? "文件" : "图片";
          return (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
                mode === k
                  ? "border-[var(--accent)] text-[var(--heading)]"
                  : "border-transparent text-[var(--meta)] hover:text-[var(--heading)]"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="rounded border border-[var(--hair)] bg-[var(--bg-2)] min-h-[260px] flex flex-col">
        {mode === "text" && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              placeholder="把甲方简报粘贴进来…"
              className="flex-1 w-full bg-transparent rounded-t p-3 text-sm text-[var(--body)] outline-none resize-none min-h-[200px]"
            />
            <div className="text-xs text-[var(--faint)] px-3 py-2 border-t border-[var(--hair)]">
              {text.length} 字
            </div>
          </>
        )}

        {mode === "file" && (
          <>
            <DropZone
              over={over}
              onOver={(b) => setOver(b)}
              accept=".pdf,.docx,.md,.txt"
              hint="拖入 .pdf / .docx / .md / .txt，或点击选择"
              onFiles={(fs) => addFiles(fs, "doc")}
              dropping={dropping}
              filled={files.length > 0}
            />
            {files.length > 0 && (
              <div className="border-t border-[var(--hair)] p-3 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--bg-1)] text-sm">
                    <span className="text-[var(--accent)]">📄</span>
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-[var(--faint)]">{(f.size / 1024).toFixed(1)} KB</span>
                    <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-[var(--meta)] hover:text-[var(--red)]">✕</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {mode === "image" && (
          <>
            <DropZone
              over={over}
              onOver={(b) => setOver(b)}
              accept="image/*"
              hint="把截图直接拖进来，可批量"
              multiple
              onFiles={(fs) => addFiles(fs, "image")}
              dropping={dropping}
              filled={files.filter((f) => f.kind === "image").length > 0}
            />
            {files.filter((f) => f.kind === "image").length > 0 && (
              <div className="border-t border-[var(--hair)] p-3 grid grid-cols-4 gap-2">
                {files.map((f, i) =>
                  f.kind === "image" ? (
                    <div key={i} className="relative group rounded bg-[var(--bg-1)] aspect-square flex items-center justify-center text-[var(--faint)]">
                      <span className="text-3xl">🖼</span>
                      <span className="absolute bottom-1 left-1 right-1 text-[10px] text-[var(--meta)] truncate text-center">{f.name}</span>
                      <button
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute top-1 right-1 w-5 h-5 rounded bg-[var(--bg-0)] text-[var(--meta)] hover:text-[var(--red)] opacity-0 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  ) : null
                )}
              </div>
            )}
          </>
        )}
      </div>

      <fieldset className="rounded border border-[var(--hair)] bg-[var(--bg-1)] p-4 space-y-3">
        <legend className="px-2 text-xs text-[var(--meta)]">产品信息（可选）</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="产品名" v={productName} set={setProductName} ph="例：Cursor IDE" />
          <Field label="官方网站" v={productUrl} set={setProductUrl} ph="https://" />
          <Field label="试用 / 注册地址" v={trialUrl} set={setTrialUrl} ph="https://" />
          <Field label="备注" v={notes} set={setNotes} ph="想强调的角度…" />
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-3">
        <button className="text-xs text-[var(--meta)] hover:text-[var(--heading)]">保存为草稿</button>
        <button
          onClick={submit}
          className="px-5 py-2.5 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold hover:shadow-[0_0_12px_var(--accent-dim)] transition-shadow"
        >
          提交并解析 →
        </button>
      </div>
    </div>
  );
}

function Field({ label, v, set, ph }: { label: string; v: string; set: (s: string) => void; ph: string }) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--meta)] block mb-1">{label}</span>
      <input
        value={v}
        onChange={(e) => set(e.target.value)}
        placeholder={ph}
        className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
      />
    </label>
  );
}

function DropZone({
  over, onOver, accept, hint, multiple, onFiles, filled,
}: {
  over: boolean;
  onOver: (b: boolean) => void;
  accept: string;
  hint: string;
  multiple?: boolean;
  onFiles: (files: FileList) => void;
  dropping: React.MutableRefObject<boolean>;
  filled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onOver(true); }}
      onDragLeave={() => onOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        onOver(false);
        if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex-1 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
        over ? "bg-[var(--accent-fill)]" : "hover:bg-[var(--bg-1)]"
      } ${filled ? "min-h-[120px]" : "min-h-[200px]"}`}
    >
      <span className="text-3xl text-[var(--accent)]">⇣</span>
      <span className="text-sm text-[var(--body)]">{hint}</span>
      <span className="text-xs text-[var(--faint)]">支持拖拽 · 点击选择</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); }}
      />
    </div>
  );
}
