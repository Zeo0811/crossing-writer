import { useState } from "react";
import { api } from "../../api/client";

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
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="w-full border rounded p-2"
          placeholder="粘贴 Brief 原文…"
        />
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
