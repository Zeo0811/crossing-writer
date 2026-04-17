export type WikiKind = "entity" | "concept" | "case" | "observation" | "person";

export interface WikiPageMeta {
  path: string;
  kind: WikiKind;
  title: string;
  aliases: string[];
  sources_count: number;
  backlinks_count: number;
  last_ingest?: string;
}

export interface WikiSearchResult {
  path: string;
  kind: WikiKind;
  title: string;
  aliases: string[];
  excerpt: string;
  frontmatter: Record<string, unknown>;
  score: number;
}

export interface WikiStatus {
  total: number;
  by_kind: Record<string, number>;
  last_ingest_at: string | null;
}

// SSE event types from backend (prefix "ingest." stripped)
export interface IngestStreamEvent {
  type: string;                // e.g. "batch_started" / "op_applied" / "all_completed" / "result" / "error"
  account?: string;
  batchIndex?: number;
  totalBatches?: number;
  op?: string;
  path?: string;
  duration_ms?: number;
  stats?: Record<string, unknown>;
  error?: string;
  // result-specific:
  accounts_done?: string[];
  pages_created?: number;
  pages_updated?: number;
  sources_appended?: number;
  images_appended?: number;
  notes?: string[];
}

export async function getPages(kind?: WikiKind): Promise<WikiPageMeta[]> {
  const url = kind ? `/api/kb/wiki/pages?kind=${encodeURIComponent(kind)}` : "/api/kb/wiki/pages";
  const r = await fetch(url);
  if (!r.ok) throw new Error(`getPages ${r.status}`);
  return (await r.json()) as WikiPageMeta[];
}

export async function getPage(path: string): Promise<string> {
  const r = await fetch(`/api/kb/wiki/pages/${path}`);
  if (!r.ok) throw new Error(`getPage ${r.status}`);
  return await r.text();
}

export async function search(input: { query: string; kind?: WikiKind; limit?: number }): Promise<WikiSearchResult[]> {
  const params = new URLSearchParams({ q: input.query });
  if (input.kind) params.set("kind", input.kind);
  if (input.limit) params.set("limit", String(input.limit));
  const r = await fetch(`/api/kb/wiki/search?${params.toString()}`);
  if (!r.ok) throw new Error(`search ${r.status}`);
  return (await r.json()) as WikiSearchResult[];
}

export async function status(): Promise<WikiStatus> {
  const r = await fetch("/api/kb/wiki/status");
  if (!r.ok) throw new Error(`status ${r.status}`);
  return (await r.json()) as WikiStatus;
}

export interface IngestStartArgs {
  accounts: string[];
  per_account_limit: number;
  batch_size: number;
  mode: "full" | "incremental";
  since?: string;
  until?: string;
  cli_model?: { cli: "claude" | "codex"; model?: string };
}

export interface IngestStream {
  close: () => void;
}

export function startIngestStream(
  args: IngestStartArgs,
  onEvent: (e: IngestStreamEvent) => void,
  onDone: (result?: IngestStreamEvent) => void,
  onError: (err: string) => void,
): IngestStream {
  const ctrl = new AbortController();
  void (async () => {
    try {
      const r = await fetch("/api/kb/wiki/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(args),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) {
        const text = await r.text().catch(() => "");
        onError(`HTTP ${r.status}: ${text}`);
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let lastResult: IngestStreamEvent | undefined;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const chunk of parts) {
          const lines = chunk.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const fullType = eventLine.slice(6).trim();           // "ingest.batch_started"
          const type = fullType.startsWith("ingest.") ? fullType.slice("ingest.".length) : fullType;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;
          try {
            const data = JSON.parse(payload) as Record<string, unknown>;
            const ev: IngestStreamEvent = { type, ...data };
            if (type === "result") {
              lastResult = ev;
            } else if (type === "error") {
              onError((data.error as string) ?? "unknown error");
              return;
            } else {
              onEvent(ev);
            }
          } catch { /* ignore parse error */ }
        }
      }
      onDone(lastResult);
    } catch (err) {
      if ((err as Error).name !== "AbortError") onError((err as Error).message);
    }
  })();
  return { close: () => ctrl.abort() };
}

export interface WikiFrontmatter {
  type: WikiKind;
  title: string;
  aliases?: string[];
  sources?: Array<{ account: string; article_id: string; quoted: string }>;
  backlinks?: string[];
  images?: Array<{ url: string; caption?: string; from_article?: string }>;
  last_ingest?: string;
  [k: string]: unknown;
}

export interface WikiPageFull {
  frontmatter: WikiFrontmatter;
  body: string;
}

export async function getPageMeta(path: string): Promise<WikiPageFull> {
  const r = await fetch(`/api/kb/wiki/pages/${path}?meta=1`);
  if (!r.ok) throw new Error(`getPageMeta ${r.status}`);
  return (await r.json()) as WikiPageFull;
}

export interface WikiIndexEntry {
  path: string;
  title: string;
  aliases: string[];
}

export async function getWikiIndex(): Promise<WikiIndexEntry[]> {
  const r = await fetch(`/api/kb/wiki/index.json`);
  if (!r.ok) throw new Error(`getWikiIndex ${r.status}`);
  return (await r.json()) as WikiIndexEntry[];
}

export interface RawArticle {
  id: string;
  account: string;
  title: string;
  author: string | null;
  published_at: string;
  url: string | null;
  body_plain: string;
  md_path: string | null;
  word_count: number | null;
}

export async function getRawArticle(account: string, id: string): Promise<RawArticle> {
  const r = await fetch(`/api/kb/raw-articles/${encodeURIComponent(account)}/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`getRawArticle ${r.status}`);
  return (await r.json()) as RawArticle;
}
