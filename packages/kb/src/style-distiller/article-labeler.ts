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

/** Single-article convenience shape (backwards-compatible). */
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

/** Backwards-compatible single-article API. Delegates to labelArticlesBatch. */
export async function labelArticle(
  sample: ArticleSample,
  opts: LabelerInvoke,
): Promise<LabeledArticle> {
  const result = await labelArticlesBatch(
    [{ sample, paragraphs: opts.paragraphs }],
    opts.invoke,
  );
  if (result.length !== 1) {
    throw new Error(`article-labeler: expected 1 result, got ${result.length}`);
  }
  return result[0]!;
}

export interface BatchItem {
  sample: ArticleSample;
  paragraphs: string[];
}

export async function labelArticlesBatch(
  items: BatchItem[],
  invoke: LabelerInvokeFn,
): Promise<LabeledArticle[]> {
  if (items.length === 0) return [];
  const userMessage = buildBatchUserMessage(items);
  const sys = loadSystemPrompt();
  const resp = await invoke({
    systemPrompt: sys,
    userMessage,
    model: 'claude-sonnet-4-5',
  });
  return parseBatchResponse(items, resp.text, resp.meta.durationMs);
}

export function buildBatchUserMessage(items: BatchItem[]): string {
  const chunks: string[] = [];
  for (const { sample, paragraphs } of items) {
    const lines = paragraphs.map((p, i) => {
      const trimmed = p.length > 200 ? p.slice(0, 200) + '…' : p;
      const flat = trimmed.replace(/\n/g, ' ');
      return `P${i + 1}|${flat}`;
    });
    chunks.push(`ARTICLE ${sample.id}:\n${lines.join('\n')}`);
  }
  return chunks.join('\n\n');
}

export function parseBatchResponse(
  items: BatchItem[],
  rawText: string,
  durationMs: number,
): LabeledArticle[] {
  const cleaned = rawText.replace(/```[a-z]*\n?/g, '').replace(/```$/g, '').trim();
  const parsed = yaml.load(cleaned) as any;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`article-labeler: non-object YAML: ${cleaned.slice(0, 200)}`);
  }
  const byId = parsed.articles;
  if (!byId || typeof byId !== 'object') {
    throw new Error(`article-labeler: missing "articles" map in YAML`);
  }

  const results: LabeledArticle[] = [];
  for (const { sample, paragraphs } of items) {
    const entry = byId[sample.id];
    if (!entry || typeof entry !== 'object') {
      throw new Error(`article-labeler: missing entry for article ${sample.id}`);
    }
    if (!ARTICLE_TYPES.includes(entry.article_type)) {
      throw new Error(`article-labeler: invalid article_type "${entry.article_type}" for ${sample.id}`);
    }
    const roleMap = new Map<string, Role>();
    const labeled = entry.paragraphs ?? {};
    for (let i = 0; i < paragraphs.length; i++) {
      const key = `P${i + 1}`;
      const role = labeled[key];
      if (!VALID_ROLES.includes(role)) {
        if (role === undefined) {
          throw new Error(`article-labeler: ${sample.id} missing label for ${key}`);
        }
        throw new Error(`article-labeler: ${sample.id} invalid label "${role}" for ${key}`);
      }
      roleMap.set(key, role as Role);
    }
    results.push({ articleId: sample.id, type: entry.article_type, paragraphRoles: roleMap, durationMs });
  }
  return results;
}
