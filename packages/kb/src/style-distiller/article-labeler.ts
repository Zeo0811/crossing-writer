import yaml from 'js-yaml';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ArticleSample } from './types.js';
import { ARTICLE_TYPES, type ArticleType, type Role } from './panel-v2-schema.js';

export interface LabeledArticle {
  articleId: string;
  type: ArticleType;
  paragraphRoles: Map<string, Role>;
  durationMs: number;
}

export interface LabelerInvokeFn {
  (opts: {
    systemPrompt: string;
    userMessage: string;
    model?: string;
  }): Promise<{ text: string; meta: { cli: string; durationMs: number } }>;
}

export interface LabelerInvoke {
  invoke: LabelerInvokeFn;
  paragraphs: string[];
}

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(THIS_DIR, '../../../agents/src/prompts/article-labeler.md');

let cachedPrompt: string | null = null;
function loadSystemPrompt(): string {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = readFileSync(PROMPT_PATH, 'utf-8');
  return cachedPrompt;
}

const VALID_ROLES: Role[] = ['opening', 'practice', 'closing', 'other'];

export async function labelArticle(
  sample: ArticleSample,
  opts: LabelerInvoke,
): Promise<LabeledArticle> {
  const userMessage = buildUserMessage(opts.paragraphs);
  const sys = loadSystemPrompt();
  const resp = await opts.invoke({
    systemPrompt: sys,
    userMessage,
    model: 'claude-opus-4-6',
  });
  return parseResponse(sample.id, opts.paragraphs, resp.text, resp.meta.durationMs);
}

export function buildUserMessage(paragraphs: string[]): string {
  const lines = paragraphs.map((p, i) => {
    const trimmed = p.length > 200 ? p.slice(0, 200) + '…' : p;
    const flat = trimmed.replace(/\n/g, ' ');
    return `P${i + 1}|${flat}`;
  });
  return `Article paragraphs:\n${lines.join('\n')}`;
}

export function parseResponse(
  articleId: string,
  paragraphs: string[],
  rawText: string,
  durationMs: number,
): LabeledArticle {
  const cleaned = rawText.replace(/```[a-z]*\n?/g, '').replace(/```$/g, '').trim();
  const parsed = yaml.load(cleaned) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`article-labeler: non-object YAML for ${articleId}: ${cleaned.slice(0, 80)}`);
  }
  if (!ARTICLE_TYPES.includes(parsed['article_type'] as ArticleType)) {
    throw new Error(`article-labeler: invalid article_type "${parsed['article_type']}" for ${articleId}`);
  }
  const roleMap = new Map<string, Role>();
  const labeled = (parsed['paragraphs'] ?? {}) as Record<string, unknown>;
  for (let i = 0; i < paragraphs.length; i++) {
    const key = `P${i + 1}`;
    const role = labeled[key];
    if (role === undefined) {
      throw new Error(`article-labeler: ${articleId} missing label for ${key}`);
    }
    if (!VALID_ROLES.includes(role as Role)) {
      throw new Error(`article-labeler: ${articleId} invalid label "${role}" for ${key}`);
    }
    roleMap.set(key, role as Role);
  }
  return { articleId, type: parsed['article_type'] as ArticleType, paragraphRoles: roleMap, durationMs };
}
