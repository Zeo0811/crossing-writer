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
    label: "选题 / 需求解析",
    agentKeys: ["brief_analyst", "coordinator", "topic_expert", "product_overview"],
  },
  {
    label: "Case 规划",
    agentKeys: ["case_coordinator", "case_planner_expert"],
  },
  {
    label: "初稿创作",
    agentKeys: [
      "writer.opening",
      "writer.practice",
      "writer.closing",
      "practice_stitcher",
      "style_critic",
    ],
  },
  {
    label: "辅助工具",
    agentKeys: [
      "style_distiller.composer",
      "style_distiller.snippets",
      "style_distiller.structure",
      "section_slicer",
      "wiki_ingestor",
    ],
  },
];

function defaultAgentConfig(key: string): AgentConfigEntry {
  const isWriter = key.startsWith("writer.");
  const base: AgentConfigEntry = {
    agentKey: key,
    model: { cli: "claude", model: "claude-opus-4.6" },
  };
  if (isWriter) {
    base.tools = { search_wiki: true, search_raw: true };
  }
  return base;
}

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

  if (loading) return <div className="text-sm text-[var(--meta)] p-4">加载中…</div>;
  if (error) return <div className="text-sm text-[var(--red)] p-4">错误：{error}</div>;

  function handleAddTopicExpert() {
    // eslint-disable-next-line no-alert
    const specialty = window.prompt?.("请输入 topic_expert 专长名（例：赛博禅心）")?.trim();
    if (!specialty) return;
    const key = `topic_expert.${specialty}`;
    if (agents[key]) return;
    setAgents((prev) => ({ ...prev, [key]: defaultAgentConfig(key) }));
  }

  // Expand agent keys per step: topic_expert → all topic_expert.* instances (or placeholder)
  function expandStepKeys(step: StepGroup): string[] {
    const out: string[] = [];
    for (const k of step.agentKeys) {
      if (k === "topic_expert") {
        const specialties = Object.keys(agents)
          .filter((ak) => ak.startsWith("topic_expert."))
          .sort();
        if (specialties.length === 0) {
          // keep bare topic_expert as placeholder; card will show unconfigured badge
          out.push("topic_expert");
        } else {
          out.push(...specialties);
        }
      } else {
        out.push(k);
      }
    }
    return out;
  }

  return (
    <div className="space-y-6">
      {error && <div className="text-sm text-[var(--red)]">错误：{error}</div>}
      {STEPS.map((step) => {
        const keys = expandStepKeys(step);
        const hasTopicExpert = step.agentKeys.includes("topic_expert");
        return (
          <section key={step.label}>
            <h2 className="text-sm font-semibold mb-3 text-[var(--heading)]">
              {step.label}
            </h2>
            <div className="space-y-2">
            {keys.map((key) => {
              const cfg = agents[key] ?? defaultAgentConfig(key);
              const unconfigured = !agents[key];
              const role = writerRole(key);
              const styleChoices = role ? (panelsByRole.get(role) ?? []) : [];
              return (
                <AgentCard
                  key={key}
                  agentKey={key}
                  agentConfig={cfg}
                  unconfigured={unconfigured}
                  stylePanelChoices={styleChoices}
                  modelChoices={MODEL_CHOICES}
                  onChange={(next) => { void handleChange(key, next); }}
                />
              );
            })}
            </div>
            {hasTopicExpert && (
              <button
                type="button"
                onClick={handleAddTopicExpert}
                className="mt-2 px-3 py-1.5 text-xs rounded border border-[var(--hair-strong)] text-[var(--meta)] hover:text-[var(--accent)] hover:border-[var(--accent-soft)]"
                data-testid="add-topic-expert-btn"
              >
                ＋ 新增选题专家
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
