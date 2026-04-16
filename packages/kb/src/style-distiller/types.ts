export interface QuantResult {
  account: string;
  article_count: number;
  date_range: { start: string; end: string };
  word_count: { median: number; p10: number; p90: number };
  opening_words: { median: number; p10: number; p90: number };
  closing_words: { median: number; p10: number; p90: number };
  case_section_words: { median: number; p10: number; p90: number };
  paragraph_length_sentences: { median: number; p10: number; p90: number };
  bold_per_section: { median: number; p10: number; p90: number };
  emoji_density: Record<string, number>;
  image_to_text_ratio: number;
  pronoun_ratio: { we: number; you: number; none: number };
  top_transition_words: Array<{ word: string; count: number }>;
}

export interface ArticleSample {
  id: string;
  account: string;
  title: string;
  published_at: string;
  word_count: number;
  body_plain: string;
}

export interface SnippetCandidate {
  tag: string;
  from: string;
  excerpt: string;
  position_ratio: number;
  length: number;
}

export type DistillStep = "quant" | "structure" | "snippets" | "composer";

export interface DistillStepEvent {
  step: DistillStep;
  phase: "started" | "completed" | "failed" | "batch_progress";
  account: string;
  duration_ms?: number;
  error?: string;
  stats?: Record<string, unknown>;
}

export interface DistillOptions {
  account: string;
  sampleSize: number;
  since?: string;
  until?: string;
  onlyStep?: DistillStep;
  dryRun?: boolean;
  cliModelPerStep?: Partial<Record<"structure" | "snippets" | "composer", { cli: "claude" | "codex"; model?: string }>>;
  onEvent?: (ev: DistillStepEvent) => void;
}

export interface DistillResult {
  account: string;
  kb_path: string;
  sample_size_actual: number;
  steps_run: DistillStep[];
}

import type { ArticleType } from './panel-v2-schema.js';
export type { LabeledArticle } from './article-labeler.js';

export interface BucketV2 {
  role: 'opening' | 'practice' | 'closing';
  type: ArticleType;
  sample_count: number;
  snippets: Array<{
    article_id: string;
    title: string;
    excerpt: string;
    word_count: number;
  }>;
  quant: {
    word_count_median: number;
    word_count_p10: number;
    word_count_p90: number;
  };
}

export interface AggregatedV2 {
  account: string;
  buckets: BucketV2[];
  banned_vocabulary_candidates: string[];
}

export interface DistillV2Options {
  account: string;
  sampleSize: number;
  since?: string;
  until?: string;
  runId: string;
  onEvent?: (ev: { type: string; data: Record<string, unknown> }) => void;
  /** Injected labeler invoke — implementer supplies bridge to model-adapter. */
  invokeLabeler: (opts: {
    systemPrompt: string;
    userMessage: string;
    model?: string;
  }) => Promise<{ text: string; meta: { cli: string; durationMs: number } }>;
  /** Injected composer invoke — same shape. */
  invokeComposer: (opts: {
    systemPrompt: string;
    userMessage: string;
    model?: string;
  }) => Promise<{ text: string; meta: { cli: string; durationMs: number } }>;
}

export interface DistillV2Result {
  account: string;
  files: string[];
}
