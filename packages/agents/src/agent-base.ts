import { invokeAgent, type AgentResult } from "./model-adapter.js";

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

  run(userMessage: string, extraVars?: Record<string, string>): AgentResult {
    const vars = { ...this.opts.vars, ...extraVars };
    const systemPrompt = this.interpolate(this.opts.systemPromptTemplate, vars);
    return invokeAgent({
      agentKey: this.opts.key,
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt,
      userMessage,
      timeout: this.opts.timeout,
    });
  }
}
