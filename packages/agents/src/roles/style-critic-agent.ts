import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";
import type { ReferenceAccountKb } from "./writer-opening-agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/style-critic.md"),
  "utf-8",
);

export interface StyleCriticInput {
  fullArticle: string;
  sectionKeys: string[];
  referenceAccountsKb: ReferenceAccountKb[];
}

export interface StyleCriticOutput {
  rewrites: Record<string, string>;
  meta: { cli: string; model?: string | null; durationMs: number };
}

export class StyleCriticAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async critique(input: StyleCriticInput): Promise<StyleCriticOutput> {
    const refBlock = input.referenceAccountsKb.length === 0
      ? "(无参考账号)"
      : input.referenceAccountsKb
          .map((r) => `## 参考账号：${r.id}\n${r.text}`)
          .join("\n\n");
    const userMessage = [
      "# 当前 section_keys",
      input.sectionKeys.map((k) => `- ${k}`).join("\n"),
      "",
      "# 整篇首拼稿",
      input.fullArticle,
      "",
      "# 参考账号风格素材",
      refBlock,
      "",
      "按 system prompt 格式输出。",
    ].join("\n");

    const result = invokeAgent({
      agentKey: "style_critic",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
    });

    const rewrites: Record<string, string> = {};
    if (result.text.trim() !== "NO_CHANGES") {
      const re = /##\s+REWRITE\s+section:([^\s\n]+)\s*\n([\s\S]*?)(?=(\n##\s+REWRITE\s+section:)|$)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(result.text))) {
        const key = m[1]!.trim();
        if (input.sectionKeys.includes(key)) {
          rewrites[key] = m[2]!.trim();
        }
      }
    }

    return {
      rewrites,
      meta: {
        cli: result.meta.cli,
        model: result.meta.model ?? null,
        durationMs: result.meta.durationMs,
      },
    };
  }
}
