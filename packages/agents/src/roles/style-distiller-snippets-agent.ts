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
      `输出 JSON 数组。`,
    ].join("\n");

    const result = invokeAgent({
      agentKey: "style_distiller.snippets",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
    });
    let parsed: HarvestedSnippet[];
    try {
      parsed = JSON.parse(stripFence(result.text));
    } catch (e) {
      throw new Error(`snippets agent: failed to parse JSON output: ${(e as Error).message}`);
    }
    if (!Array.isArray(parsed)) throw new Error("snippets agent: output is not an array");
    return {
      candidates: parsed,
      meta: { cli: result.meta.cli, model: result.meta.model ?? null, durationMs: result.meta.durationMs },
    };
  }
}
