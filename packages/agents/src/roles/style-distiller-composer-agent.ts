import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/style-distiller-composer.md"),
  "utf-8",
);

export interface ComposerInput {
  account: string;
  sampleSizeRequested: number;
  sampleSizeActual: number;
  sourcePoolSize: number;
  articleDateRange: { start: string; end: string };
  distilledAt: string;
  stepClis: {
    structure: { cli: string; model?: string };
    snippets: { cli: string; model?: string };
    composer: { cli: string; model?: string };
  };
  deepReadIds: string[];
  quantJson: string;
  structureMd: string;
  snippetsYaml: string;
}

export interface ComposerOutput {
  kbMd: string;
  meta: { cli: string; model?: string | null; durationMs: number };
}

function yamlFrontmatter(input: ComposerInput): string {
  const lines = [
    "---",
    "type: style_expert",
    `account: ${input.account}`,
    "version: v2",
    `distilled_from: ${input.sampleSizeActual} 篇样本（从 ${input.articleDateRange.start}~${input.articleDateRange.end} 范围的 ${input.sourcePoolSize} 篇中采样）`,
    `sample_size_requested: ${input.sampleSizeRequested}`,
    `sample_size_actual: ${input.sampleSizeActual}`,
    `article_date_range: ${input.articleDateRange.start} ~ ${input.articleDateRange.end}`,
    `distilled_at: ${input.distilledAt}`,
    "distilled_by:",
    `  structure: ${input.stepClis.structure.cli}/${input.stepClis.structure.model ?? "default"}`,
    `  snippets: ${input.stepClis.snippets.cli}/${input.stepClis.snippets.model ?? "default"}`,
    `  composer: ${input.stepClis.composer.cli}/${input.stepClis.composer.model ?? "default"}`,
    "sample_articles_read_in_full:",
    ...input.deepReadIds.map((id) => `  - ${id}`),
    "---",
  ];
  return lines.join("\n");
}

export class StyleDistillerComposerAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async compose(input: ComposerInput): Promise<ComposerOutput> {
    const userMessage = [
      `# 账号：${input.account}`,
      ``,
      `# 量化 JSON`,
      "```json",
      input.quantJson,
      "```",
      ``,
      `# 结构 md`,
      input.structureMd,
      ``,
      `# 片段 YAML`,
      "```yaml",
      input.snippetsYaml,
      "```",
      ``,
      `按 system prompt 合成正文（不写 frontmatter）。`,
    ].join("\n");

    const result = invokeAgent({
      agentKey: "style_distiller.composer",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
    });

    const kbMd = `${yamlFrontmatter(input)}\n${result.text.trim()}\n`;
    return {
      kbMd,
      meta: { cli: result.meta.cli, model: result.meta.model ?? null, durationMs: result.meta.durationMs },
    };
  }
}
