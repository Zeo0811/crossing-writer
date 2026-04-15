import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";
import { TOOL_PROTOCOL_PROMPT } from "../prompts/load.js";
import type { ReferenceAccountKb } from "./writer-opening-agent.js";
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
  join(__dirname, "../prompts/style-critic.md"),
  "utf-8",
);

export function getSystemPrompt(): string {
  return `${SYSTEM_PROMPT}\n\n${TOOL_PROTOCOL_PROMPT}`;
}

export interface StyleCriticInput {
  fullArticle: string;
  sectionKeys: string[];
  referenceAccountsKb: ReferenceAccountKb[];
}

export interface StyleCriticOutput {
  rewrites: Record<string, string>;
  meta: { cli: string; model?: string | null; durationMs: number };
}

export interface RunStyleCriticOpts {
  invokeAgent: (messages: ChatMessage[], opts?: { images?: string[] }) => Promise<{ text: string; meta: { cli: string; model?: string; durationMs: number } }>;
  userMessage: string;
  images?: string[];
  pinnedContext?: string;
  dispatchTool: (call: ToolCall) => Promise<SkillResult>;
  onEvent?: (ev: WriterToolEvent) => void;
  sectionKey?: string;
  maxRounds?: number;
}

export async function runStyleCritic(opts: RunStyleCriticOpts): Promise<WriterRunResult> {
  return runWriterWithTools({
    agent: { invoke: opts.invokeAgent },
    agentName: "style_critic",
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

    const result = await invokeAgent({
      agentKey: "style_critic",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: getSystemPrompt(),
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
