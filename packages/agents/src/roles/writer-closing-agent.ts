import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";
import { TOOL_PROTOCOL_PROMPT } from "../prompts/load.js";
import type { ReferenceAccountKb, WriterOutput } from "./writer-opening-agent.js";
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
  join(__dirname, "../prompts/writer-closing.md"),
  "utf-8",
);

export function getSystemPrompt(): string {
  return `${SYSTEM_PROMPT}\n\n${TOOL_PROTOCOL_PROMPT}`;
}

export interface WriterClosingInput {
  openingText: string;
  stitchedPracticeText: string;
  referenceAccountsKb: ReferenceAccountKb[];
}

export interface RunWriterClosingOpts {
  invokeAgent: (messages: ChatMessage[], opts?: { images?: string[] }) => Promise<{ text: string; meta: { cli: string; model?: string; durationMs: number } }>;
  userMessage: string;
  images?: string[];
  pinnedContext?: string;
  dispatchTool: (call: ToolCall) => Promise<SkillResult>;
  onEvent?: (ev: WriterToolEvent) => void;
  sectionKey?: string;
  maxRounds?: number;
}

export async function runWriterClosing(opts: RunWriterClosingOpts): Promise<WriterRunResult> {
  return runWriterWithTools({
    agent: { invoke: opts.invokeAgent },
    agentName: "writer.closing",
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

    const result = await invokeAgent({
      agentKey: "writer.closing",
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
