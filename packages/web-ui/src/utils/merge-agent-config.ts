import type {
  AgentConfigEntry,
  ProjectOverride,
} from "../api/writer-client.js";

/**
 * Frontend port of packages/web-server/src/services/config-merger.ts.
 *
 * Semantics:
 * - agentKey always from global.
 * - model / promptVersion / styleBinding: override wins whole subtree if present.
 * - tools: shallow per-key merge.
 */
export function mergeAgentConfig(
  global: AgentConfigEntry,
  override?: Partial<AgentConfigEntry>,
): AgentConfigEntry {
  if (!override) {
    return {
      agentKey: global.agentKey,
      ...(global.model ? { model: { ...global.model } } : {}),
      ...(global.promptVersion !== undefined ? { promptVersion: global.promptVersion } : {}),
      ...(global.styleBinding ? { styleBinding: { ...global.styleBinding } } : {}),
      ...(global.tools ? { tools: { ...global.tools } } : {}),
    };
  }
  const mergedModel = override.model ? { ...override.model } : global.model ? { ...global.model } : undefined;
  const merged: AgentConfigEntry = {
    agentKey: global.agentKey,
    ...(mergedModel ? { model: mergedModel } : {}),
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
