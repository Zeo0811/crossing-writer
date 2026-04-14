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
  join(__dirname, "../prompts/writer-practice.md"),
  "utf-8",
);

export function getSystemPrompt(): string {
  return `${SYSTEM_PROMPT}\n\n${TOOL_PROTOCOL_PROMPT}`;
}

export interface WriterPracticeInput {
  caseId: string;
  caseName: string;
  caseDescription: string;
  notesBody: string;
  notesFrontmatter: Record<string, unknown>;
  screenshotPaths: string[];
  referenceAccountsKb: ReferenceAccountKb[];
}

export interface RunWriterPracticeOpts {
  invokeAgent: (messages: ChatMessage[], opts?: { images?: string[] }) => Promise<{ text: string; meta: { cli: string; model?: string; durationMs: number } }>;
  userMessage: string;
  images?: string[];
  pinnedContext?: string;
  dispatchTool: (call: ToolCall) => Promise<SkillResult>;
  onEvent?: (ev: WriterToolEvent) => void;
  sectionKey?: string;
  maxRounds?: number;
}

export async function runWriterPractice(opts: RunWriterPracticeOpts): Promise<WriterRunResult> {
  return runWriterWithTools({
    agent: { invoke: opts.invokeAgent },
    agentName: "writer.practice",
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

export class WriterPracticeAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async write(input: WriterPracticeInput): Promise<WriterOutput> {
    const refBlock = input.referenceAccountsKb.length === 0
      ? "(无参考账号)"
      : input.referenceAccountsKb
          .map((r) => `## 参考账号：${r.id}\n${r.text}`)
          .join("\n\n");

    const userMessage = [
      `# Case 编号：${input.caseId}`,
      `# Case 名：${input.caseName}`,
      "",
      "# Case 详细描述",
      input.caseDescription || "(无)",
      "",
      "# 实测笔记 frontmatter",
      "```yaml",
      JSON.stringify(input.notesFrontmatter, null, 2),
      "```",
      "",
      "# 实测笔记正文",
      input.notesBody || "(无)",
      "",
      "# 截图清单",
      input.screenshotPaths.length === 0
        ? "(无)"
        : input.screenshotPaths.map((p, i) => `- screenshot-${i + 1}: ${p}`).join("\n"),
      "",
      "# 参考账号风格素材",
      refBlock,
      "",
      "请按 system prompt 要求产出该 case 实测小节。",
    ].join("\n");

    const result = invokeAgent({
      agentKey: "writer.practice",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: getSystemPrompt(),
      userMessage,
      images: input.screenshotPaths,
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
