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
  /** Optional per-role total word-count override. When set, takes precedence
   *  over panel's `### 字数范围` subsection text. Tuple is [min, max]. */
  word_count_overrides?: {
    opening?: [number, number];
    closing?: [number, number];
    article?: [number, number];
  };
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
// parseWordCountRange
// ============================================================================

/**
 * Parse a 字数范围 text like "10 – 110 字(单段)" or "150-260 字".
 * Supports: hyphen-minus / em dash / en dash as range separator,
 *          full- or half-width parens on "单段" suffix,
 *          "X 字以内" form (min defaults to 0).
 * Returns null for unparseable inputs.
 */
export function parseWordCountRange(
  text: string,
): { min: number; max: number; perPara: boolean } | null {
  if (!text) return null;
  const perPara = /[（(]单段[）)]/.test(text);
  // Range form: "min <dash> max 字"
  const rangeRe = /(\d+)\s*[-–—]\s*(\d+)\s*字/u;
  const m = text.match(rangeRe);
  if (m) {
    const min = Number.parseInt(m[1]!, 10);
    const max = Number.parseInt(m[2]!, 10);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { min, max, perPara };
    }
  }
  // "X 字以内" form
  const capRe = /(\d+)\s*字\s*以内/u;
  const m2 = text.match(capRe);
  if (m2) {
    const max = Number.parseInt(m2[1]!, 10);
    if (Number.isFinite(max)) {
      return { min: 0, max, perPara };
    }
  }
  return null;
}

// ============================================================================
// resolveWordConstraint
// ============================================================================

export interface WordConstraint {
  /** Per-paragraph range text, e.g. "每段 10 – 110 字", or "—" if unknown */
  perParaText: string;
  /** Total-range text shown to the writer, e.g. "200 – 400 字（硬规则指定）" */
  totalText: string;
  /** Numeric upper bound, used by self-review checklist template */
  totalMax: number;
}

/** Default paragraph count per role — used to extrapolate total bound when
 *  panel only gives per-paragraph range and no override is provided. */
const DEFAULT_PARA_COUNT = { opening: 5, closing: 7 } as const;

/** Absolute safe default when neither panel nor override is set. */
const ABSOLUTE_DEFAULT_TOTAL: Record<'opening' | 'closing', [number, number]> = {
  opening: [150, 400],
  closing: [150, 350],
};

/**
 * Merge panel 字数范围 subsection, optional yaml override, and fallback into a
 * single word constraint for the writer prompt.
 *
 * Priority (highest first):
 *   1. override [min, max] — yaml hard rule, trumps all
 *   2. panel parsed as total range — pass through
 *   3. panel parsed as per-paragraph range — multiply by DEFAULT_PARA_COUNT[role]
 *   4. nothing parseable — ABSOLUTE_DEFAULT_TOTAL[role]
 */
export function resolveWordConstraint(
  role: 'opening' | 'closing',
  panelSubsText: string,
  override?: [number, number],
): WordConstraint {
  const parsed = parseWordCountRange(panelSubsText);
  const perParaText = parsed?.perPara
    ? `每段 ${parsed.min} – ${parsed.max} 字`
    : '—';

  if (override) {
    const [min, max] = override;
    return {
      perParaText,
      totalText: `${min} – ${max} 字（硬规则指定）`,
      totalMax: max,
    };
  }

  if (parsed && parsed.perPara) {
    const n = DEFAULT_PARA_COUNT[role];
    return {
      perParaText,
      totalText: `${parsed.min * n} – ${parsed.max * n} 字（单段 × ${n} 段推算）`,
      totalMax: parsed.max * n,
    };
  }

  if (parsed && !parsed.perPara) {
    return {
      perParaText: '—',
      totalText: `${parsed.min} – ${parsed.max} 字`,
      totalMax: parsed.max,
    };
  }

  const [min, max] = ABSOLUTE_DEFAULT_TOTAL[role];
  return {
    perParaText: '—',
    totalText: `${min} – ${max} 字（默认兜底，建议在硬规则里覆盖）`,
    totalMax: max,
  };
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
  /** Override [min, max] total word count. If provided, takes precedence
   *  over panel 字数范围 text; see resolveWordConstraint. */
  wordOverride?: [number, number];
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

  const wordConstraint = resolveWordConstraint(
    opts.role,
    subs.字数范围,
    opts.wordOverride,
  );

  // Conditional blocks — render only the matching role's block, drop the other
  let out = applyConditionalBlocks(template, opts.role);

  const fm = opts.panelFrontmatter;
  const replacements: Record<string, string> = {
    '{{account}}': opts.account,
    '{{article_type}}': opts.articleType,
    '{{role中文}}': roleCn,
    '{{panel.目标}}': subs.目标,
    '{{panel.word_count_per_para}}': wordConstraint.perParaText,
    '{{panel.word_count_total}}': wordConstraint.totalText,
    '{{panel.word_count_total_max}}': String(wordConstraint.totalMax),
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
