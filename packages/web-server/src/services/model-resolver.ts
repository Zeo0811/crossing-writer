import type { DefaultModelConfig, DefaultModelEntry } from '../config.js';

/**
 * SP-C resolver. Routes agentKey to the writer or other tier.
 * Writer tier: any agentKey starting with `writer.` (covers opening/practice/closing).
 * Other tier: everything else (brief_analyst, practice.stitcher, style_critic, topic_expert.*, etc.).
 *
 * Returns a shallow copy so callers can mutate without leaking into the
 * shared config.
 */
export function resolveModelForAgent(
  agentKey: string,
  defaultModel: DefaultModelConfig,
): DefaultModelEntry {
  const source = agentKey.startsWith('writer.') ? defaultModel.writer : defaultModel.other;
  return { ...source };
}
