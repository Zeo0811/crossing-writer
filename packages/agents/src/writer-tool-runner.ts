export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AgentInvoker {
  invoke(
    messages: ChatMessage[],
    opts?: { images?: string[]; addDirs?: string[] },
  ): Promise<{ text: string; meta: { cli: string; model?: string; durationMs: number } }>;
}

export type ToolCall = { command: string; args: string[] };

export type SkillResult =
  | {
      ok: true;
      tool: string;
      query: string;
      args: Record<string, string>;
      hits: unknown[];
      hits_count: number;
      formatted: string;
    }
  | {
      ok: false;
      tool: string;
      query: string;
      args: Record<string, string>;
      error: string;
    };

export interface ToolUsage {
  tool: string;
  query: string;
  args: Record<string, string>;
  pinned_by: "auto" | `manual:${string}`;
  round: number;
  hits_count: number;
  hits_summary: Array<{
    path?: string;
    title?: string;
    score?: number;
    account?: string;
    article_id?: string;
  }>;
}

export type WriterToolEvent =
  | {
      type: "tool_called" | "tool_returned" | "tool_failed" | "tool_round_completed";
      section_key?: string;
      agent: string;
      tool?: string;
      args?: Record<string, string>;
      round: number;
      hits_count?: number;
      duration_ms?: number;
      error?: string;
      total_tools_in_round?: number;
    }
  | {
      type: "selection_rewritten";
      sectionKey: string;
      selected_text: string;
      new_text: string;
      ts: string;
    };

export interface WriterRunOptions {
  agent: AgentInvoker;
  agentName: string;
  sectionKey?: string;
  systemPrompt: string;
  initialUserMessage: string;
  maxRounds?: number;
  pinnedContext?: string;
  dispatchTool: (call: ToolCall) => Promise<SkillResult>;
  onEvent?: (ev: WriterToolEvent) => void;
  images?: string[];
  addDirs?: string[];
}

export interface WriterRunResult {
  finalText: string;
  toolsUsed: ToolUsage[];
  rounds: number;
  meta: {
    cli: string;
    model?: string;
    durationMs: number;
    total_duration_ms: number;
  };
}

const TOOL_BLOCK_RE = /```tool\s*\n([\s\S]*?)\n```/g;

export function parseToolCalls(text: string): ToolCall[] {
  const out: ToolCall[] = [];
  let m: RegExpExecArray | null;
  TOOL_BLOCK_RE.lastIndex = 0;
  while ((m = TOOL_BLOCK_RE.exec(text))) {
    const body = m[1]!;
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const tokens = tokenize(line);
      if (!tokens.length) continue;
      out.push({ command: tokens[0]!, args: tokens.slice(1) });
    }
  }
  return out;
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[1] !== undefined ? `"${m[1]}"` : m[2]!);
  }
  return out;
}

export async function runWriterWithTools(opts: WriterRunOptions): Promise<WriterRunResult> {
  const maxRounds = Math.max(1, opts.maxRounds ?? 5);
  const systemPrompt = opts.pinnedContext
    ? `${opts.systemPrompt}\n\n## User-pinned references\n\n${opts.pinnedContext}`
    : opts.systemPrompt;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: opts.initialUserMessage },
  ];

  const toolsUsed: ToolUsage[] = [];
  let lastMeta = { cli: "claude", model: undefined as string | undefined, durationMs: 0 };
  let totalMs = 0;
  let lastText = "";
  let round = 0;

  for (round = 1; round <= maxRounds; round++) {
    const invokeOpts: { images?: string[]; addDirs?: string[] } = {};
    if (opts.images && opts.images.length > 0) invokeOpts.images = opts.images;
    if (opts.addDirs && opts.addDirs.length > 0) invokeOpts.addDirs = opts.addDirs;
    const resp = await opts.agent.invoke(
      messages,
      Object.keys(invokeOpts).length > 0 ? invokeOpts : undefined,
    );
    lastText = resp.text;
    lastMeta = { cli: resp.meta.cli, model: resp.meta.model, durationMs: resp.meta.durationMs };
    totalMs += resp.meta.durationMs ?? 0;

    const calls = parseToolCalls(resp.text);
    if (calls.length === 0) {
      return {
        finalText: lastText,
        toolsUsed,
        rounds: round,
        meta: { ...lastMeta, total_duration_ms: totalMs },
      };
    }

    if (round >= maxRounds) {
      opts.onEvent?.({
        type: "tool_round_completed",
        section_key: opts.sectionKey,
        agent: opts.agentName,
        round,
        total_tools_in_round: 0,
      });
      break;
    }

    const formattedResults: string[] = [];
    for (const call of calls) {
      const t0 = Date.now();
      opts.onEvent?.({
        type: "tool_called",
        section_key: opts.sectionKey,
        agent: opts.agentName,
        tool: call.command,
        args: argsToObject(call.args),
        round,
      });
      let result: SkillResult;
      try {
        result = await opts.dispatchTool(call);
      } catch (e) {
        result = {
          ok: false,
          tool: call.command,
          query: call.args[0] ?? "",
          args: argsToObject(call.args),
          error: (e as Error).message || String(e),
        };
      }
      const dt = Date.now() - t0;

      if (result.ok) {
        opts.onEvent?.({
          type: "tool_returned",
          section_key: opts.sectionKey,
          agent: opts.agentName,
          tool: result.tool,
          round,
          hits_count: result.hits_count,
          duration_ms: dt,
        });
        toolsUsed.push({
          tool: result.tool,
          query: result.query,
          args: result.args,
          pinned_by: "auto",
          round,
          hits_count: result.hits_count,
          hits_summary: summarizeHits(result.hits),
        });
        formattedResults.push(`### ${result.tool} "${result.query}" (round ${round})\n${result.formatted}`);
      } else {
        opts.onEvent?.({
          type: "tool_failed",
          section_key: opts.sectionKey,
          agent: opts.agentName,
          tool: result.tool,
          round,
          duration_ms: dt,
          error: result.error,
        });
        toolsUsed.push({
          tool: result.tool,
          query: result.query,
          args: result.args,
          pinned_by: "auto",
          round,
          hits_count: 0,
          hits_summary: [],
        });
        formattedResults.push(`### ${result.tool} "${result.query}" (round ${round})\n(失败: ${result.error})`);
      }
    }

    opts.onEvent?.({
      type: "tool_round_completed",
      section_key: opts.sectionKey,
      agent: opts.agentName,
      round,
      total_tools_in_round: calls.length,
    });

    messages.push({ role: "assistant", content: lastText });
    messages.push({
      role: "user",
      content: `工具结果（round ${round}）：\n\n${formattedResults.join("\n\n")}\n\n请基于结果继续。如果还需要查就发新的 tool 块，否则直接输出最终段落。`,
    });
  }

  return {
    finalText: lastText,
    toolsUsed,
    rounds: round,
    meta: { ...lastMeta, total_duration_ms: totalMs },
  };
}

function argsToObject(tokens: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tokens) {
    const m = t.match(/^--([a-zA-Z_]+)=(.*)$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

function summarizeHits(hits: unknown[]): ToolUsage["hits_summary"] {
  return hits.slice(0, 20).map((h) => {
    const r = h as Record<string, unknown>;
    return {
      path: typeof r.path === "string" ? r.path : undefined,
      title: typeof r.title === "string" ? r.title : undefined,
      score: typeof r.score === "number" ? r.score : undefined,
      account: typeof r.account === "string" ? r.account : undefined,
      article_id: typeof r.article_id === "string" ? r.article_id : undefined,
    };
  });
}
