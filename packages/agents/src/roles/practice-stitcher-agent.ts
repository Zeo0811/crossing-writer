import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/practice-stitcher.md"),
  "utf-8",
);

export interface StitcherCase {
  caseId: string;
  firstLines: string;
  lastLines: string;
}

export interface StitcherInput {
  cases: StitcherCase[];
}

export interface StitcherOutput {
  transitions: Record<string, string>;
  meta: { cli: string; model?: string | null; durationMs: number } | null;
}

export class PracticeStitcherAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async stitch(input: StitcherInput): Promise<StitcherOutput> {
    if (input.cases.length < 2) {
      return { transitions: {}, meta: null };
    }
    const userMessage = [
      "# Case 列表（按顺序）",
      input.cases
        .map((c, i) =>
          [
            `## ${c.caseId}（第 ${i + 1} 个）`,
            "### 开头前几句",
            c.firstLines,
            "### 结尾后几句",
            c.lastLines,
          ].join("\n"),
        )
        .join("\n\n"),
      "",
      `请按 system prompt 格式输出 ${input.cases.length - 1} 条过渡。`,
    ].join("\n");

    const result = invokeAgent({
      agentKey: "practice.stitcher",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
    });

    const transitions: Record<string, string> = {};
    const re = /##\s+transition\.([a-z0-9-]+)\s*\n([\s\S]*?)(?=(\n##\s+transition\.)|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(result.text))) {
      transitions[m[1]!] = m[2]!.trim();
    }

    return {
      transitions,
      meta: {
        cli: result.meta.cli,
        model: result.meta.model ?? null,
        durationMs: result.meta.durationMs,
      },
    };
  }
}
