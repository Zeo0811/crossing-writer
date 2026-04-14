import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";
import { TOOL_PROTOCOL_PROMPT } from "../prompts/load.js";
import {
  runWriterWithTools,
  type ChatMessage,
  type WriterRunResult,
  type ToolCall,
  type SkillResult,
  type WriterToolEvent,
} from "../writer-tool-runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/writer-opening.md"),
  "utf-8",
);

export function getSystemPrompt(): string {
  return `${SYSTEM_PROMPT}\n\n${TOOL_PROTOCOL_PROMPT}`;
}

export interface ReferenceAccountKb {
  id: string;
  text: string;
}

export interface WriterOpeningInput {
  briefSummary: string;
  missionSummary: string;
  productOverview: string;
  referenceAccountsKb: ReferenceAccountKb[];
}

export interface WriterOutput {
  text: string;
  meta: { cli: string; model?: string | null; durationMs: number };
}

export interface RunWriterOpeningOpts {
  invokeAgent: (messages: ChatMessage[], opts?: { images?: string[] }) => Promise<{ text: string; meta: { cli: string; model?: string; durationMs: number } }>;
  userMessage: string;
  images?: string[];
  pinnedContext?: string;
  dispatchTool: (call: ToolCall) => Promise<SkillResult>;
  onEvent?: (ev: WriterToolEvent) => void;
  sectionKey?: string;
  maxRounds?: number;
}

export async function runWriterOpening(opts: RunWriterOpeningOpts): Promise<WriterRunResult> {
  return runWriterWithTools({
    agent: { invoke: opts.invokeAgent },
    agentName: "writer.opening",
    sectionKey: opts.sectionKey,
    systemPrompt: getSystemPrompt(),
    initialUserMessage: opts.userMessage,
    pinnedContext: opts.pinnedContext,
    dispatchTool: opts.dispatchTool,
    onEvent: opts.onEvent,
    images: opts.images,
    maxRounds: opts.maxRounds,
  });
}

export class WriterOpeningAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async write(input: WriterOpeningInput): Promise<WriterOutput> {
    const refBlock = input.referenceAccountsKb.length === 0
      ? "(无参考账号)"
      : input.referenceAccountsKb
          .map((r) => `## 参考账号：${r.id}\n${r.text}`)
          .join("\n\n");
    const userMessage = [
      "# Brief 摘要",
      input.briefSummary || "(无)",
      "",
      "# Mission 摘要",
      input.missionSummary || "(无)",
      "",
      "# 产品概览",
      input.productOverview || "(无)",
      "",
      "# 参考账号风格素材",
      refBlock,
      "",
      "请按 system prompt 要求产出开头段正文。",
    ].join("\n");

    const result = invokeAgent({
      agentKey: "writer.opening",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: getSystemPrompt(),
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
