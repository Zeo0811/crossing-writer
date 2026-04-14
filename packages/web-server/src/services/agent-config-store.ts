import type { ConfigStore } from "./config-store.js";

export const AGENT_KEY_ALLOWLIST = [
  "writer.opening",
  "writer.practice",
  "writer.closing",
  "style_critic",
  "case_planner_expert",
  "brief_analyst",
  "coordinator",
  "case_coordinator",
  "topic_expert",
  "product_overview",
  "practice_stitcher",
  "wiki_ingestor",
  "style_distiller.composer",
  "style_distiller.snippets",
  "style_distiller.structure",
  "section_slicer",
] as const;

export type AgentKey = (typeof AGENT_KEY_ALLOWLIST)[number];

// topic_expert.<specialty> — specialty can include CJK characters, word chars, digits, hyphen
const TOPIC_EXPERT_SPECIALTY_RE = /^topic_expert\.[\w\u4e00-\u9fff-]+$/;

export type StyleBindingRole = "opening" | "practice" | "closing";

export interface AgentStyleBinding {
  account: string;
  role: StyleBindingRole;
}

export interface AgentModelConfig {
  cli: "claude" | "codex";
  model?: string;
}

export interface AgentToolsConfig {
  [toolKey: string]: boolean;
}

export interface AgentConfigEntry {
  agentKey: string;
  model: AgentModelConfig;
  promptVersion?: string;
  styleBinding?: AgentStyleBinding;
  tools?: AgentToolsConfig;
}

export interface AgentConfigStore {
  getAll(): Record<string, AgentConfigEntry>;
  get(agentKey: string): AgentConfigEntry | null;
  set(agentKey: string, cfg: AgentConfigEntry): Promise<void>;
  remove(agentKey: string): Promise<void>;
}

function isAllowedAgentKey(key: string): boolean {
  if ((AGENT_KEY_ALLOWLIST as readonly string[]).includes(key)) return true;
  if (TOPIC_EXPERT_SPECIALTY_RE.test(key)) return true;
  return false;
}

function validate(agentKey: string, cfg: AgentConfigEntry): void {
  if (!isAllowedAgentKey(agentKey)) {
    throw new Error(`invalid agent config: unknown agentKey "${agentKey}"`);
  }
  if (!cfg || typeof cfg !== "object") {
    throw new Error("invalid agent config: cfg must be an object");
  }
  if (!cfg.model || typeof cfg.model !== "object") {
    throw new Error("invalid agent config: model is required");
  }
  if (cfg.model.cli !== "claude" && cfg.model.cli !== "codex") {
    throw new Error(`invalid agent config: cli must be "claude" or "codex"`);
  }
  if (cfg.styleBinding !== undefined) {
    const sb = cfg.styleBinding;
    if (!sb || typeof sb !== "object") {
      throw new Error("invalid agent config: styleBinding must be an object");
    }
    if (!sb.account || typeof sb.account !== "string" || sb.account.trim() === "") {
      throw new Error("invalid agent config: styleBinding.account must be non-empty");
    }
    if (sb.role !== "opening" && sb.role !== "practice" && sb.role !== "closing") {
      throw new Error(`invalid agent config: styleBinding.role must be opening|practice|closing`);
    }
  }
}

export function createAgentConfigStore(configStore: ConfigStore): AgentConfigStore {
  function getAll(): Record<string, AgentConfigEntry> {
    return (configStore.current.agents ?? {}) as unknown as Record<string, AgentConfigEntry>;
  }

  return {
    getAll,
    get(agentKey) {
      const all = getAll();
      return all[agentKey] ?? null;
    },
    async set(agentKey, cfg) {
      validate(agentKey, cfg);
      const current = getAll();
      const nextAgents = { ...current, [agentKey]: cfg };
      await configStore.update({ agents: nextAgents as never });
    },
    async remove(agentKey) {
      const current = getAll();
      if (!(agentKey in current)) return;
      const nextAgents = { ...current };
      delete nextAgents[agentKey];
      await configStore.update({ agents: nextAgents as never });
    },
  };
}
