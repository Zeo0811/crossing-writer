import { useEffect, useState } from "react";
import { startWriter, listStylePanels, type WriterAgentKey, type StylePanelEntry } from "../../api/writer-client";
import { Button, Input, FormField } from "../ui";

const AGENT_KEYS: WriterAgentKey[] = [
  "writer.opening", "writer.practice", "writer.closing",
  "practice.stitcher", "style_critic",
];
const AGENTS_WITH_REFS = new Set<WriterAgentKey>(["writer.opening", "writer.practice", "writer.closing", "style_critic"]);

const LABELS: Record<string, string> = {
  "writer.opening": "开篇",
  "writer.practice": "Case 正文",
  "writer.closing": "收束",
  "practice.stitcher": "段落拼接",
  "style_critic": "风格审查",
};

export interface WriterConfigFormProps {
  projectId: string;
  defaults: Record<WriterAgentKey, { cli: "claude" | "codex"; model?: string }>;
  onStarted: () => void;
}

export function WriterConfigForm({ projectId, defaults, onStarted }: WriterConfigFormProps) {
  const [panels, setPanels] = useState<StylePanelEntry[]>([]);
  const [cliModel, setCliModel] = useState(defaults);
  const [refs, setRefs] = useState<Record<WriterAgentKey, Set<string>>>(() => {
    const init: any = {};
    for (const k of AGENT_KEYS) init[k] = new Set<string>();
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listStylePanels().then(setPanels).catch(() => setPanels([])); }, []);

  const toggleRef = (agent: WriterAgentKey, id: string) => {
    setRefs((r) => {
      const next = { ...r, [agent]: new Set(r[agent]) };
      if (next[agent].has(id)) next[agent].delete(id); else next[agent].add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const refsPayload: Record<string, string[]> = {};
      for (const k of AGENT_KEYS) refsPayload[k] = [...refs[k]];
      await startWriter(projectId, {
        cli_model_per_agent: cliModel,
        reference_accounts_per_agent: refsPayload as any,
      });
      onStarted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {AGENT_KEYS.map((agent) => (
          <div key={agent} className="rounded bg-[var(--bg-2)] p-4 space-y-3">
            <div className="text-sm font-semibold text-[var(--heading)]">{LABELS[agent] ?? agent}</div>
            <div className="grid grid-cols-2 gap-2">
              <FormField label="CLI">
                <select
                  value={cliModel[agent]?.cli ?? "claude"}
                  onChange={(e) => setCliModel({ ...cliModel, [agent]: { ...cliModel[agent], cli: e.target.value as any } })}
                  className="w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded px-2 py-1.5 text-xs outline-none focus:border-[var(--accent-soft)]"
                >
                  <option value="claude">claude</option>
                  <option value="codex">codex</option>
                </select>
              </FormField>
              <FormField label="模型">
                <Input
                  value={cliModel[agent]?.model ?? ""}
                  onChange={(e) => setCliModel({ ...cliModel, [agent]: { ...cliModel[agent]!, model: e.target.value } })}
                  className="text-xs bg-[var(--bg-1)]"
                  style={{ fontFamily: "var(--font-mono)" }}
                />
              </FormField>
            </div>
            {AGENTS_WITH_REFS.has(agent) && panels.length > 0 && (
              <div>
                <div className="text-xs text-[var(--meta)] mb-1.5">参考账号</div>
                <div className="flex flex-wrap gap-2">
                  {panels.map((p) => {
                    const checked = refs[agent].has(p.id);
                    return (
                      <label key={p.id} className="flex items-center gap-1.5 text-xs text-[var(--body)] cursor-pointer" aria-label={`${agent}-${p.id}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRef(agent, p.id)}
                          className="accent-[var(--accent)]"
                        />
                        {p.id}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] px-3 py-2 text-sm text-[var(--red)]">{error}</div>}
      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSubmit} loading={submitting}>
          {submitting ? "启动中…" : "开始写作 →"}
        </Button>
      </div>
    </div>
  );
}
