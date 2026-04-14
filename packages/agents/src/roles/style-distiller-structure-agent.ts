import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/style-distiller-structure.md"),
  "utf-8",
);

export interface StructureSample {
  id: string;
  title: string;
  published_at: string;
  word_count: number;
  body_plain: string;
}

export interface StructureDistillInput {
  account: string;
  samples: StructureSample[];
  quantSummary: string;
}

export interface StructureDistillOutput {
  text: string;
  meta: { cli: string; model?: string | null; durationMs: number };
}

export class StyleDistillerStructureAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async distill(input: StructureDistillInput): Promise<StructureDistillOutput> {
    if (input.samples.length === 0) {
      throw new Error("at least one sample required");
    }
    const samplesBlock = input.samples.map((s, i) => [
      `## Sample ${i + 1}: ${s.id}`,
      `- 标题：${s.title}`,
      `- 发布日期：${s.published_at}`,
      `- 字数：${s.word_count}`,
      ``,
      s.body_plain,
    ].join("\n")).join("\n\n---\n\n");

    const userMessage = [
      `# 账号：${input.account}`,
      ``,
      `# 量化摘要`,
      input.quantSummary,
      ``,
      `# 代表文章（${input.samples.length} 篇）`,
      samplesBlock,
      ``,
      `按 system prompt 输出 10 节结构提炼 markdown。`,
    ].join("\n");

    const result = invokeAgent({
      agentKey: "style_distiller.structure",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
    });
    return {
      text: result.text,
      meta: { cli: result.meta.cli, model: result.meta.model ?? null, durationMs: result.meta.durationMs },
    };
  }
}
