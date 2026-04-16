import { invokeAgent, type AgentResult, type AgentStreamEvent } from "./model-adapter.js";
export type { AgentStreamEvent };

export interface AgentOptions {
  key: string;
  systemPromptTemplate: string;
  vars?: Record<string, string>;
  cli: "claude" | "codex";
  model?: string;
  timeout?: number;
}

export class AgentBase {
  private opts: AgentOptions;

  constructor(opts: AgentOptions) {
    this.opts = opts;
  }

  protected interpolate(template: string, vars: Record<string, string> = {}): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? "");
  }

  async run(
    userMessage: string,
    extraVars?: Record<string, string>,
    extra?: {
      images?: string[];
      addDirs?: string[];
      runLogDir?: string;
      onEvent?: (ev: AgentStreamEvent) => void;
    },
  ): Promise<AgentResult> {
    const vars = { ...this.opts.vars, ...extraVars };
    const systemPrompt = this.interpolate(this.opts.systemPromptTemplate, vars);
    return invokeAgent({
      agentKey: this.opts.key,
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt,
      userMessage,
      timeout: this.opts.timeout,
      images: extra?.images,
      addDirs: extra?.addDirs,
      runLogDir: extra?.runLogDir,
      onEvent: extra?.onEvent,
    });
  }
}
