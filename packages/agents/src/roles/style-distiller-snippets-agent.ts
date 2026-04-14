import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/style-distiller-snippets.md"),
  "utf-8",
);

export interface SnippetBatchArticle {
  id: string;
  title: string;
  published_at: string;
  word_count: number;
  body_plain: string;
}

export interface SnippetHarvestInput {
  account: string;
  batchIndex: number;
  totalBatches: number;
  articles: SnippetBatchArticle[];
}

export interface HarvestedSnippet {
  tag: string;
  from: string;
  excerpt: string;
  position_ratio: number;
  length: number;
}

export interface SnippetHarvestOutput {
  candidates: HarvestedSnippet[];
  meta: { cli: string; model?: string | null; durationMs: number };
}

function stripFence(text: string): string {
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(text.trim());
  return m ? m[1]!.trim() : text.trim();
}

export class StyleDistillerSnippetsAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async harvest(input: SnippetHarvestInput): Promise<SnippetHarvestOutput> {
    const articlesBlock = input.articles.map((a) => [
      `## ${a.id}`,
      `标题：${a.title}  日期：${a.published_at}  字数：${a.word_count}`,
      ``,
      a.body_plain,
    ].join("\n")).join("\n\n---\n\n");

    const userMessage = [
      `# 账号：${input.account}`,
      `# 批次：${input.batchIndex + 1} / ${input.totalBatches}`,
      ``,
      `# 文章（${input.articles.length} 篇）`,
      articlesBlock,
      ``,
      `输出 NDJSON（每行一个 JSON object，不要包成数组）。`,
    ].join("\n");

    const result = invokeAgent({
      agentKey: "style_distiller.snippets",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
    });
    const parsed = parseSnippetOutput(result.text);
    if (parsed.length === 0) {
      throw new Error("snippets agent: no valid NDJSON/JSON objects parsed from output");
    }
    return {
      candidates: parsed,
      meta: { cli: result.meta.cli, model: result.meta.model ?? null, durationMs: result.meta.durationMs },
    };
  }
}

function parseSnippetOutput(raw: string): HarvestedSnippet[] {
  const text = stripFence(raw);
  // Try JSON array first (backward-compat).
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr as HarvestedSnippet[];
    } catch { /* fall through to NDJSON */ }
  }
  // NDJSON: parse each non-empty line; skip malformed lines (lenient).
  const out: HarvestedSnippet[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || !l.startsWith("{")) continue;
    try {
      const obj = JSON.parse(l);
      if (obj && typeof obj === "object" && typeof obj.tag === "string") {
        out.push(obj as HarvestedSnippet);
      }
    } catch { /* skip malformed line */ }
  }
  return out;
}
