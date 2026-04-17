import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ============================================================================
// Types (duplicated locally to avoid cross-package dependency on @crossing/web-server)
// ============================================================================

export interface WritingHardRules {
  version: 1;
  updated_at: string;
  banned_phrases: Array<{ pattern: string; is_regex: boolean; reason: string; example?: string }>;
  banned_vocabulary: Array<{ word: string; reason: string }>;
  layout_rules: string[];
}

/**
 * Subset of PanelFrontmatterV2 that renderBookendPrompt actually reads.
 * Keeping this narrow makes the agent package independent of @crossing/kb type.
 */
export interface PanelFrontmatterLike {
  word_count_ranges: {
    opening: [number, number];
    article: [number, number];
  };
  pronoun_policy: { we_ratio: number; you_ratio: number; avoid: string[] };
  tone: { primary: string; humor_frequency: string; opinionated: string };
  bold_policy: {
    frequency: string;
    what_to_bold: string[];
    dont_bold: string[];
  };
  transition_phrases: string[];
  data_citation: { required: boolean; format_style: string; min_per_article: number };
}

/**
 * Shared types used by writer-bookend-agent, writer-practice-agent,
 * style-critic-agent, and other writer roles.
 */
export interface ReferenceAccountKb {
  id: string;
  text: string;
}

export interface WriterOutput {
  text: string;
  meta: { cli: string; model?: string | null; durationMs: number };
}

// ============================================================================
// extractSubsection
// ============================================================================

/**
 * Extract the body of `### <subsectionName>` up to the next `### ` heading
 * (or end of input). Returns '' if the subsection is missing.
 *
 * Tolerant to suffix on the heading line — matches both:
 *   `### 结构骨架`                 (bare)
 *   `### 结构骨架（三选一）`         (full-width parens)
 *   `### 结构骨架(三选一)`          (half-width parens)
 * Composers in practice emit either form, depending on the LLM's mood.
 */
export function extractSubsection(typeSection: string, subsectionName: string): string {
  const escaped = subsectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)###\\s+${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n###\\s|$)`, 'u');
  const m = typeSection.match(re);
  return m?.[1]?.trim() ?? '';
}

// ============================================================================
// renderHardRulesBlock
// ============================================================================

export function renderHardRulesBlock(
  rules: WritingHardRules,
  panelBannedVocab: string[],
): string {
  const phrases = rules.banned_phrases.length
    ? rules.banned_phrases
        .map((p) => `  - ${p.pattern}${p.is_regex ? ' (regex)' : ''}：${p.reason}`)
        .join('\n')
    : '  （无）';

  const mergedVocab = Array.from(
    new Set([
      ...rules.banned_vocabulary.map((v) => v.word),
      ...panelBannedVocab,
    ]),
  );
  const vocab = mergedVocab.length
    ? mergedVocab.map((w) => `  - ${w}`).join('\n')
    : '  （无）';

  const layout = rules.layout_rules.length
    ? rules.layout_rules.map((r) => `  - ${r}`).join('\n')
    : '  （无）';

  return `## 写作硬规则（绝对不允许违反）\n\n禁用句式：\n${phrases}\n\n禁用词汇：\n${vocab}\n\n排版规则：\n${layout}`;
}

// ============================================================================
// renderBookendPrompt
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, '../prompts/writer-bookend.md');

let cachedTemplate: string | null = null;
function loadTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = readFileSync(TEMPLATE_PATH, 'utf-8');
  return cachedTemplate;
}

export interface RenderBookendPromptOpts {
  role: 'opening' | 'closing';
  account: string;
  articleType: '实测' | '访谈' | '评论';
  typeSection: string;
  panelFrontmatter: PanelFrontmatterLike;
  hardRulesBlock: string;
  projectContextBlock: string;
  product_name?: string;
  guest_name?: string;
}

export function renderBookendPrompt(opts: RenderBookendPromptOpts): string {
  const template = loadTemplate();
  const roleCn = opts.role === 'opening' ? '开头' : '结尾';

  // Extract 6 subsections. extractSubsection is suffix-tolerant, so passing
  // just the bare name catches `### 结构骨架`, `### 结构骨架(三选一)`, and
  // `### 结构骨架（三选一）` — all three forms composers emit in practice.
  const subs = {
    目标: extractSubsection(opts.typeSection, '目标'),
    字数范围: extractSubsection(opts.typeSection, '字数范围'),
    结构骨架: extractSubsection(opts.typeSection, '结构骨架'),
    高频锚词: extractSubsection(opts.typeSection, '高频锚词'),
    禁止出现: extractSubsection(opts.typeSection, '禁止出现'),
    示例: extractSubsection(opts.typeSection, '示例'),
  };

  // Panel schema has `word_count_ranges.opening` and `word_count_ranges.article`
  // but NOT a closing-specific range. For closing, the per-role "字数范围"
  // subsection text in the panel body is the real source of truth (e.g.
  // "10 – 110 字(单段)"). Use it whenever available; fall back to the
  // frontmatter numeric range only if the subsection is missing.
  const wordRange = subs.字数范围
    ? subs.字数范围
    : opts.role === 'opening'
      ? `${opts.panelFrontmatter.word_count_ranges.opening.join('-')} 字`
      : `${opts.panelFrontmatter.word_count_ranges.article.join('-')} 字（全文参考，非本段独占）`;

  // Conditional blocks — render only the matching role's block, drop the other
  let out = applyConditionalBlocks(template, opts.role);

  const fm = opts.panelFrontmatter;
  const replacements: Record<string, string> = {
    '{{account}}': opts.account,
    '{{article_type}}': opts.articleType,
    '{{role中文}}': roleCn,
    '{{panel.目标}}': subs.目标,
    '{{panel.word_count}}': wordRange,
    '{{panel.结构骨架}}': subs.结构骨架,
    '{{panel.高频锚词}}': subs.高频锚词,
    '{{panel.禁止出现}}': subs.禁止出现,
    '{{panel.示例}}': subs.示例,
    '{{panel.pronoun_policy.we_ratio}}': String(fm.pronoun_policy.we_ratio),
    '{{panel.pronoun_policy.you_ratio}}': String(fm.pronoun_policy.you_ratio),
    '{{panel.pronoun_policy.avoid}}': fm.pronoun_policy.avoid.join(' / '),
    '{{panel.tone.primary}}': fm.tone.primary,
    '{{panel.tone.humor_frequency}}': fm.tone.humor_frequency,
    '{{panel.tone.opinionated}}': fm.tone.opinionated,
    '{{panel.bold_policy.frequency}}': fm.bold_policy.frequency,
    '{{panel.bold_policy.what_to_bold}}': fm.bold_policy.what_to_bold.join(' / '),
    '{{panel.bold_policy.dont_bold}}': fm.bold_policy.dont_bold.join(' / '),
    '{{panel.transition_phrases}}': fm.transition_phrases.join(' | '),
    '{{panel.data_citation.required}}': String(fm.data_citation.required),
    '{{panel.data_citation.format_style}}': fm.data_citation.format_style,
    '{{product_name}}': opts.product_name ?? '（未知产品）',
    '{{guest_name}}': opts.guest_name ?? '（未知嘉宾）',
    '{{hardRulesBlock}}': opts.hardRulesBlock,
    '{{projectContextBlock}}': opts.projectContextBlock,
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    out = out.split(placeholder).join(value);
  }

  // Safety: any leftover {{placeholder}} indicates a template bug
  const leftover = out.match(/\{\{[^}]+\}\}/);
  if (leftover) {
    throw new Error(`writer-shared: unreplaced placeholder in prompt: ${leftover[0]}`);
  }

  return out;
}

/**
 * Handle {{#if role === 'opening'}}...{{/if}} and {{#if role === 'closing'}}...{{/if}}
 * by keeping only the block matching current role and dropping the other.
 */
function applyConditionalBlocks(template: string, role: 'opening' | 'closing'): string {
  const openingRe = /\{\{#if role === 'opening'\}\}([\s\S]*?)\{\{\/if\}\}/g;
  const closingRe = /\{\{#if role === 'closing'\}\}([\s\S]*?)\{\{\/if\}\}/g;
  return template
    .replace(openingRe, (_m, body) => (role === 'opening' ? body : ''))
    .replace(closingRe, (_m, body) => (role === 'closing' ? body : ''));
}
