import type { AgentConfigEntry } from "./agent-config-store.js";
import type { ProjectOverride } from "./project-override-store.js";

/**
 * Pure helper: merge a global AgentConfigEntry with an optional project override.
 *
 * Semantics:
 * - `agentKey` always taken from global.
 * - `model`, `promptVersion`, `styleBinding`: override wins whole subtree if present.
 * - `tools`: shallow per-key merge so one flag can flip without rewriting all.
 * - Missing override fields fall back to global.
 */
export function mergeAgentConfig(
  global: AgentConfigEntry,
  override?: Partial<AgentConfigEntry>,
): AgentConfigEntry {
  if (!override) {
    return {
      agentKey: global.agentKey,
      model: { ...global.model },
      ...(global.promptVersion !== undefined ? { promptVersion: global.promptVersion } : {}),
      ...(global.styleBinding ? { styleBinding: { ...global.styleBinding } } : {}),
      ...(global.tools ? { tools: { ...global.tools } } : {}),
    };
  }

  const merged: AgentConfigEntry = {
    agentKey: global.agentKey,
    model: override.model ? { ...override.model } : { ...global.model },
  };

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
