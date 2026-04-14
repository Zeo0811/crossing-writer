import { useEffect, useState } from "react";
import { startWriter, listStylePanels, type WriterAgentKey, type StylePanelEntry } from "../../api/writer-client";

const AGENT_KEYS: WriterAgentKey[] = [
  "writer.opening", "writer.practice", "writer.closing",
  "practice.stitcher", "style_critic",
];
const AGENTS_WITH_REFS = new Set<WriterAgentKey>(["writer.opening", "writer.practice", "writer.closing", "style_critic"]);

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
    <div className="flex flex-col gap-4 p-4">
      {AGENT_KEYS.map((agent) => (
        <section key={agent} className="border rounded p-3">
          <h3 className="font-semibold mb-2">{agent}</h3>
          <div className="flex gap-2 mb-2">
            <label>cli:
              <select value={cliModel[agent]?.cli ?? "claude"} onChange={(e) => setCliModel({ ...cliModel, [agent]: { ...cliModel[agent], cli: e.target.value as any } })}>
                <option value="claude">claude</option>
                <option value="codex">codex</option>
              </select>
            </label>
            <label>model:
              <input value={cliModel[agent]?.model ?? ""} onChange={(e) => setCliModel({ ...cliModel, [agent]: { ...cliModel[agent]!, model: e.target.value } })} />
            </label>
          </div>
          {AGENTS_WITH_REFS.has(agent) && (
            <div className="flex flex-wrap gap-2">
              <span className="text-sm text-gray-600">参考账号：</span>
              {panels.map((p) => (
                <label key={p.id} aria-label={`${agent}-${p.id}`}>
                  <input type="checkbox" checked={refs[agent].has(p.id)} onChange={() => toggleRef(agent, p.id)} />
                  {p.id}
                </label>
              ))}
            </div>
          )}
        </section>
      ))}
      {error && <div className="text-red-600 text-sm">{error}</div>}
      <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded">
        {submitting ? "启动中…" : "开始写作"}
      </button>
    </div>
  );
}
