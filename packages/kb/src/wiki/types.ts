export type WikiKind = "entity" | "concept" | "case" | "observation" | "person";

export interface WikiFrontmatter {
  type: WikiKind;
  title: string;
  aliases?: string[];
  sources: Array<{ account: string; article_id: string; quoted: string }>;
  backlinks?: string[];
  images?: Array<{ url: string; caption?: string; from_article?: string }>;
  last_ingest: string;
  [key: string]: unknown;
}

export interface WikiPage { path: string; frontmatter: WikiFrontmatter; body: string }

export type PatchOp =
  | { op: "upsert"; path: string; frontmatter: Partial<WikiFrontmatter>; body: string }
  | { op: "append_source"; path: string; source: { account: string; article_id: string; quoted: string } }
  | { op: "append_image"; path: string; image: { url: string; caption?: string; from_article?: string } }
  | { op: "add_backlink"; path: string; to: string }
  | { op: "note"; body: string };

export type IngestMode = "full" | "incremental" | "selected";

export interface IngestStepEvent {
  type: "batch_started" | "op_applied" | "batch_completed" | "batch_failed" | "account_completed" | "all_completed" | "article_skipped" | "run_started" | "run_completed";
  runId?: string;
  account?: string;
  articleId?: string;   // NEW — used for article_skipped events
  batchIndex?: number;
  totalBatches?: number;
  op?: string;
  path?: string;
  duration_ms?: number;
  stats?: Record<string, unknown>;
  error?: string;
}

export interface IngestOptions {
  accounts: string[];
  perAccountLimit: number;
  batchSize: number;
  since?: string;
  until?: string;
  cliModel?: { cli: "claude" | "codex"; model?: string };
  mode: IngestMode;
  articleIds?: string[];
  maxArticles?: number;
  forceReingest?: boolean;
  onEvent?: (ev: IngestStepEvent) => void;
}

export interface IngestResult {
  accounts_done: string[];
  pages_created: number;
  pages_updated: number;
  sources_appended: number;
  images_appended: number;
  notes: string[];
  skipped_count: number;
  run_id: string;   // NEW
}

export interface SearchWikiInput { query: string; kind?: WikiKind; limit?: number }

export interface SearchWikiResult {
  path: string;
  kind: WikiKind;
  title: string;
  aliases: string[];
  excerpt: string;
  frontmatter: WikiFrontmatter;
  score: number;
}
