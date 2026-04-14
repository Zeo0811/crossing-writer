import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/wiki-ingestor.md"),
  "utf-8",
);

export interface IngestArticle {
  id: string;
  title: string;
  published_at: string;
  body_plain: string;
  images?: Array<{ url: string; caption?: string }>;
}

export interface ExistingPageSnapshot {
  path: string;
  frontmatter: Record<string, unknown>;
  first_chars: string;
}

export interface IngestorInput {
  account: string;
  batchIndex: number;
  totalBatches: number;
  articles: IngestArticle[];
  existingPages: ExistingPageSnapshot[];
  indexMd: string;
  wikiGuide: string;
}

export interface IngestorOp { op: string; [k: string]: unknown }

export interface IngestorOutput {
  ops: IngestorOp[];
  meta: { cli: string; model?: string | null; durationMs: number };
}

function stripFence(text: string): string {
  const m = /^```(?:ndjson|json)?\s*([\s\S]*?)\s*```\s*$/m.exec(text.trim());
  return m ? m[1]!.trim() : text.trim();
}

export function parseNdjsonOps(raw: string): IngestorOp[] {
  const text = stripFence(raw);
  const out: IngestorOp[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || !l.startsWith("{")) continue;
    try {
      const obj = JSON.parse(l);
      if (obj && typeof obj === "object" && typeof obj.op === "string") out.push(obj as IngestorOp);
    } catch {
      // skip malformed
    }
  }
  return out;
}

export class WikiIngestorAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async ingest(input: IngestorInput): Promise<IngestorOutput> {
    const articlesBlock = input.articles.map((a) => [
      `## article ${a.id}`,
      `标题：${a.title}  日期：${a.published_at}`,
      ``,
      a.body_plain,
      ``,
      a.images && a.images.length > 0
        ? `images:\n${a.images.map((im) => `  - ${im.url}${im.caption ? ` (${im.caption})` : ""}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n")).join("\n\n---\n\n");

    const snapshotBlock = input.existingPages.length === 0
      ? "(空 wiki，没有现有相关页面)"
      : input.existingPages.map((p) => [
          `### ${p.path}`,
          `frontmatter: ${JSON.stringify(p.frontmatter)}`,
          `preview: ${p.first_chars}`,
        ].join("\n")).join("\n\n");

    const userMessage = [
      `# GUIDE`,
      input.wikiGuide,
      ``,
      `# 当前 index.md`,
      input.indexMd || "(空)",
      ``,
      `# 可能相关的现有页面`,
      snapshotBlock,
      ``,
      `# 账号：${input.account}`,
      `# 批次：${input.batchIndex + 1} / ${input.totalBatches}`,
      ``,
      `# 文章（${input.articles.length} 篇）`,
      articlesBlock,
      ``,
      `输出 NDJSON。第一字符必须是 "{"。`,
    ].join("\n");

    const result = invokeAgent({
      agentKey: "wiki.ingestor",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
    });
    const ops = parseNdjsonOps(result.text);
    return { ops, meta: { cli: result.meta.cli, model: result.meta.model ?? null, durationMs: result.meta.durationMs } };
  }
}
