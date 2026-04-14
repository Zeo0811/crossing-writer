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
