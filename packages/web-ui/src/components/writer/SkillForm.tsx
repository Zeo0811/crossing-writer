import { useState } from "react";
import { callSkill, type SkillResult } from "../../api/writer-client";

const TOOL_OPTIONS = [
  { value: "search_raw", label: "search_raw（搜索素材库）" },
  { value: "search_wiki", label: "search_wiki（搜索 Wiki）" },
];

export interface SkillFormProps {
  projectId: string;
  sectionKey: string;
  onClose: () => void;
  onResult: (r: SkillResult) => void;
}

export function SkillForm({ projectId, sectionKey, onClose, onResult }: SkillFormProps) {
  const [tool, setTool] = useState<string>(TOOL_OPTIONS[0]!.value);
  const [argsText, setArgsText] = useState("{}");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function exec() {
    setErr(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsText);
    } catch {
      setErr("JSON 解析失败");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setErr("JSON 解析失败");
      return;
    }
    // Coerce all values to strings (backend expects Record<string,string>)
    const args: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      args[k] = typeof v === "string" ? v : String(v);
    }
    setBusy(true);
    try {
      const r = await callSkill(projectId, sectionKey, tool, args);
      onResult(r);
      if (r.ok) onClose();
      else setErr(r.error ?? "调用失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <div className="w-[480px] rounded bg-white p-4 shadow">
        <div className="mb-2 text-lg font-semibold">🔧 调用工具</div>
        <label className="block text-sm" htmlFor="skill-tool">工具</label>
        <select
          id="skill-tool"
          value={tool}
          onChange={(e) => setTool(e.target.value)}
          className="mb-2 w-full border p-1"
        >
          {TOOL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <label className="block text-sm" htmlFor="skill-args">参数（JSON）</label>
        <textarea
          id="skill-args"
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          rows={6}
          className="mb-2 w-full border p-1 font-mono text-xs"
        />
        {err && <div className="mb-2 text-sm text-red-600">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="border px-3 py-1">取消</button>
          <button
            type="button"
            onClick={exec}
            disabled={busy}
            className="bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
          >
            {busy ? "执行中..." : "执行"}
          </button>
        </div>
      </div>
    </div>
  );
}
