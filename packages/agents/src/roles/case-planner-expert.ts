import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const R1 = readFileSync(join(__dirname, "../prompts/case-expert-round1.md"), "utf-8");
const R2 = readFileSync(join(__dirname, "../prompts/case-expert-round2.md"), "utf-8");

export interface CaseExpertOpts {
  name: string;
  cli: "claude" | "codex";
  model?: string;
  kbMarkdown: string;
}

export interface Round1Input {
  missionSummary: string;
  productOverview: string;
  inspirationPack: string;
}

export interface Round2Input {
  round1Draft: string;
  toolResults: string;
}

export interface CaseResult {
  text: string;
  meta: { cli: string; model?: string | null; durationMs: number };
}

export class CasePlannerExpert {
  constructor(private opts: CaseExpertOpts) {}

  async round1(input: Round1Input): Promise<CaseResult> {
    const sys = R1.replaceAll("{{expertName}}", this.opts.name);
    const user = [
      "# Mission 摘要",
      input.missionSummary,
      "",
      "# 产品概览",
      input.productOverview,
      "",
      "# Inspiration Pack",
      input.inspirationPack,
      "",
      "# 我的 KB",
      this.opts.kbMarkdown,
    ].join("\n");
    const r = invokeAgent({
      agentKey: `case_expert.${this.opts.name}`,
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: sys,
      userMessage: user,
    });
    return { text: r.text, meta: { cli: r.meta.cli, model: r.meta.model ?? null, durationMs: r.meta.durationMs } };
  }

  async round2(input: Round2Input): Promise<CaseResult> {
    const sys = R2
      .replace("{{round1Draft}}", input.round1Draft)
      .replace("{{toolResults}}", input.toolResults);
    const r = invokeAgent({
      agentKey: `case_expert.${this.opts.name}`,
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: sys,
      userMessage: "请输出 Round 2 最终 Cases。",
    });
    return { text: r.text, meta: { cli: r.meta.cli, model: r.meta.model ?? null, durationMs: r.meta.durationMs } };
  }
}
