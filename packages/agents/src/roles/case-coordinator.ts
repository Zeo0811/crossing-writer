import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM = readFileSync(join(__dirname, "../prompts/case-coordinator.md"), "utf-8");

export interface SynthesizeInput {
  expertOutputs: Array<{ expert: string; text: string }>;
  missionSummary: string;
  productOverview: string;
}

export class CaseCoordinator {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async synthesize(input: SynthesizeInput) {
    const parts: string[] = [
      "# Mission 摘要", input.missionSummary, "",
      "# 产品概览", input.productOverview, "",
      "# 专家输出（按姓名分组）",
    ];
    for (const o of input.expertOutputs) {
      parts.push("", `## 专家: ${o.expert}`, o.text);
    }
    const r = invokeAgent({
      agentKey: "case_coordinator",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM,
      userMessage: parts.join("\n"),
    });
    return { text: r.text, meta: { cli: r.meta.cli, model: r.meta.model ?? null, durationMs: r.meta.durationMs } };
  }
}
