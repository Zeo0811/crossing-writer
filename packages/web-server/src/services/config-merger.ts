import type { AgentConfigEntry } from "./agent-config-store.js";
import type { ProjectOverride } from "./project-override-store.js";
import type { DefaultModelConfig } from "../config.js";

/**
 * Pure helper: merge a global AgentConfigEntry with an optional project override.
 *
 * Semantics:
 * - `agentKey` always taken from global.
 * - `promptVersion`, `styleBinding`: override wins whole subtree if present.
 * - `tools`: shallow per-key merge so one flag can flip without rewriting all.
 * - Missing override fields fall back to global.
 *
 * Note (SP-C Task 6): `model` is no longer part of AgentConfigEntry. Model
 * selection now cascades from ServerConfig.defaultModel via resolveModelForAgent.
 */
export function mergeAgentConfig(
  global: AgentConfigEntry,
  override?: Partial<AgentConfigEntry>,
): AgentConfigEntry {
  if (!override) {
    return {
      agentKey: global.agentKey,
      ...(global.promptVersion !== undefined ? { promptVersion: global.promptVersion } : {}),
      ...(global.styleBinding ? { styleBinding: { ...global.styleBinding } } : {}),
      ...(global.tools ? { tools: { ...global.tools } } : {}),
    };
  }

  const merged: AgentConfigEntry = { agentKey: global.agentKey };

  const promptVersion =
    override.promptVersion !== undefined ? override.promptVersion : global.promptVersion;
  if (promptVersion !== undefined) merged.promptVersion = promptVersion;

  const styleBinding = override.styleBinding ? override.styleBinding : global.styleBinding;
  if (styleBinding) merged.styleBinding = { ...styleBinding };

  if (global.tools || override.tools) {
    merged.tools = { ...(global.tools ?? {}), ...(override.tools ?? {}) };
  }

  return merged;
}

export function mergeAllAgentConfigs(
  globals: Record<string, AgentConfigEntry>,
  override: ProjectOverride | null,
): Record<string, AgentConfigEntry> {
  const out: Record<string, AgentConfigEntry> = {};
  const overrideAgents = override?.agents ?? {};
  for (const [key, entry] of Object.entries(globals)) {
    out[key] = mergeAgentConfig(entry, overrideAgents[key]);
  }
  return out;
}

/**
 * SP-C Task 6: overlay a project-level partial DefaultModelConfig onto the
 * global one. Per-slot (writer/other) the override wins as a whole replacement
 * when present, otherwise the global slot is kept (deep-copied so callers can
 * mutate freely).
 */
export function mergeDefaultModel(
  global: DefaultModelConfig,
  override?: Partial<DefaultModelConfig>,
): DefaultModelConfig {
  if (!override) return { writer: { ...global.writer }, other: { ...global.other } };
  return {
    writer: override.writer ? { ...override.writer } : { ...global.writer },
    other:  override.other  ? { ...override.other  } : { ...global.other  },
  };
}
