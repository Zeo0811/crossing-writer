import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAgentConfigs,
  listConfigStylePanels,
  setAgentConfig,
  type AgentConfigEntry,
  type StylePanel,
} from "../../api/writer-client.js";
import { AgentCard, type ModelChoice } from "./AgentCard.js";

const MODEL_CHOICES: ModelChoice[] = [
  { cli: "claude", model: "claude-opus-4.6", label: "claude claude-opus-4.6" },
  { cli: "claude", model: "claude-sonnet-4.5", label: "claude claude-sonnet-4.5" },
  { cli: "codex", model: "gpt-5", label: "codex gpt-5" },
];

interface StepGroup {
  label: string;
  agentKeys: string[];
}

const STEPS: StepGroup[] = [
  {
    label: "Step 1 选题/解读",
    agentKeys: ["brief-analyst", "coordinator", "topic-expert", "product-overview"],
  },
  {
    label: "Step 2 案例策划",
    agentKeys: ["case-coordinator", "case-planner-expert"],
  },
  {
    label: "Step 4 初稿",
    agentKeys: [
      "writer.opening",
      "writer.practice",
      "writer.closing",
      "practice-stitcher",
      "style-critic",
    ],
  },
  {
    label: "Step 蒸馏工具",
    agentKeys: [
      "style-distiller.composer",
      "style-distiller.snippets",
      "style-distiller.structure",
      "section-slicer",
      "wiki-ingestor",
    ],
  },
];

function writerRole(agentKey: string): "opening" | "practice" | "closing" | null {
  if (agentKey === "writer.opening") return "opening";
  if (agentKey === "writer.practice") return "practice";
  if (agentKey === "writer.closing") return "closing";
  return null;
}

export function AgentsPanel() {
  const [agents, setAgents] = useState<Record<string, AgentConfigEntry>>({});
  const [panels, setPanels] = useState<StylePanel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfgs, pl] = await Promise.all([
          getAgentConfigs(),
          listConfigStylePanels(),
        ]);
        if (cancelled) return;
        setAgents(cfgs.agents);
        setPanels(pl.panels);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleChange = useCallback(async (key: string, next: AgentConfigEntry) => {
    try {
      await setAgentConfig(key, next);
      const cfgs = await getAgentConfigs();
      setAgents(cfgs.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const panelsByRole = useMemo(() => {
    const map = new Map<string, StylePanel[]>();
    for (const p of panels) {
      const arr = map.get(p.role) ?? [];
      arr.push(p);
      map.set(p.role, arr);
    }
    return map;
  }, [panels]);

  if (loading) return <div>Loading…</div>;
  if (error) return <div style={{ color: "var(--red)" }}>Error: {error}</div>;

  return (
    <div>
      {error && <div style={{ color: "var(--red)" }}>Error: {error}</div>}
      {STEPS.map((step) => {
        const present = step.agentKeys.filter((k) => agents[k]);
        if (present.length === 0) return null;
        return (
          <section key={step.label} className="mb-6">
            <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--green)" }}>
              {step.label}
            </h2>
            {present.map((key) => {
              const cfg = agents[key]!;
              const role = writerRole(key);
              const styleChoices = role ? (panelsByRole.get(role) ?? []) : [];
              return (
                <AgentCard
                  key={key}
                  agentKey={key}
                  agentConfig={cfg}
                  stylePanelChoices={styleChoices}
                  modelChoices={MODEL_CHOICES}
                  onChange={(next) => { void handleChange(key, next); }}
                />
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
