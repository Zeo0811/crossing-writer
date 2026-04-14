import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";
import type { ReferenceAccountKb, WriterOutput } from "./writer-opening-agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/writer-closing.md"),
  "utf-8",
);

export interface WriterClosingInput {
  openingText: string;
  stitchedPracticeText: string;
  referenceAccountsKb: ReferenceAccountKb[];
}

export class WriterClosingAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async write(input: WriterClosingInput): Promise<WriterOutput> {
    const refBlock = input.referenceAccountsKb.length === 0
      ? "(无参考账号)"
      : input.referenceAccountsKb
          .map((r) => `## 参考账号：${r.id}\n${r.text}`)
          .join("\n\n");

    const userMessage = [
      "# 开头段",
      input.openingText,
      "",
      "# 实测主体（含过渡）",
      input.stitchedPracticeText,
      "",
      "# 参考账号风格素材",
      refBlock,
      "",
      "请按 system prompt 要求产出结尾段。",
    ].join("\n");

    const result = invokeAgent({
      agentKey: "writer.closing",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
    });
    return {
      text: result.text,
      meta: {
        cli: result.meta.cli,
        model: result.meta.model ?? null,
        durationMs: result.meta.durationMs,
      },
    };
  }
}
