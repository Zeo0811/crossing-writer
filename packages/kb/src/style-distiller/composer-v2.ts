import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import type { AggregatedV2, BucketV2 } from './types.js';
import { parsePanelV2 } from './panel-parser-v2.js';

export interface ComposerInvoke {
  invoke(opts: {
    systemPrompt: string;
    userMessage: string;
    model?: string;
  }): Promise<{ text: string; meta: { cli: string; durationMs: number } }>;
}

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(THIS_DIR, '../../../agents/src/prompts/composer-v2.md');

let cachedPrompt: string | null = null;
function loadSystemPrompt(): string {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = readFileSync(PROMPT_PATH, 'utf-8');
  return cachedPrompt;
}

export async function composePanel(
  agg: AggregatedV2,
  role: 'opening' | 'practice' | 'closing',
  opts: ComposerInvoke,
): Promise<string> {
  const buckets = agg.buckets.filter((b) => b.role === role && b.sample_count > 0);
  const userMessage = buildUserMessage(agg.account, role, buckets, agg.banned_vocabulary_candidates);
  const resp = await opts.invoke({
    systemPrompt: loadSystemPrompt(),
    userMessage,
    model: 'claude-opus-4-6',
  });
  validateOutput(resp.text);
  return resp.text;
}

export function buildUserMessage(
  account: string,
  role: 'opening' | 'practice' | 'closing',
  buckets: BucketV2[],
  vocabCandidates: string[],
): string {
  const dump = {
    account,
    role,
    banned_vocabulary_candidates: vocabCandidates,
    buckets: buckets.map((b) => ({
      type: b.type,
      sample_count: b.sample_count,
      quant: b.quant,
      snippets: b.snippets.map((s) => ({ from: s.title, excerpt: s.excerpt })),
    })),
  };
  return yaml.dump(dump, { lineWidth: -1 });
}

function validateOutput(text: string): void {
  // parsePanelV2 throws a clear error if frontmatter / version / schema is wrong
  parsePanelV2('<composer-output>', text);
}
