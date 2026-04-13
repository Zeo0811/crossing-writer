import type { CasePlannerExpert, Round1Input } from "./roles/case-planner-expert.js";

export interface ToolCall {
  command: "crossing-kb";
  args: string[];
  query?: string;
  account?: string;
  limit?: number;
}

const TOOL_BLOCK_RE = /```tool\s*\n([\s\S]*?)\n```/g;

export function parseToolCalls(text: string): ToolCall[] {
  const out: ToolCall[] = [];
  let m: RegExpExecArray | null;
  TOOL_BLOCK_RE.lastIndex = 0;
  while ((m = TOOL_BLOCK_RE.exec(text))) {
    const line = m[1]!.trim();
    if (!line.startsWith("crossing-kb")) continue;
    const tokens = tokenize(line);
    if (tokens[1] !== "search") continue;
    const query = tokens[2];
    let account: string | undefined;
    let limit: number | undefined;
    for (const t of tokens.slice(3)) {
      const am = t.match(/^--account=(.+)$/);
      const lm = t.match(/^--limit=(\d+)$/);
      if (am) account = am[1];
      if (lm) limit = parseInt(lm[1]!, 10);
    }
    out.push({ command: "crossing-kb", args: ["search"], query, account, limit });
    if (out.length >= 1) break;
  }
  return out;
}

function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2]!);
  return out;
}

export type ToolExecutor = (calls: ToolCall[]) => Promise<string>;

export interface RunCaseExpertResult {
  final: { text: string; meta: any };
  roundsUsed: 1 | 2;
  toolCallsMade: ToolCall[];
}

export async function runCaseExpert(
  expert: CasePlannerExpert,
  input: Round1Input,
  runTool: ToolExecutor,
): Promise<RunCaseExpertResult> {
  const r1 = await expert.round1(input);
  const calls = parseToolCalls(r1.text);
  if (calls.length === 0) {
    return { final: r1, roundsUsed: 1, toolCallsMade: [] };
  }
  let toolResultsText: string;
  try {
    toolResultsText = await runTool(calls);
    if (!toolResultsText) toolResultsText = "(no results)";
  } catch (e) {
    toolResultsText = `(tool error: ${String(e)})`;
  }
  const r2 = await expert.round2({
    round1Draft: r1.text,
    toolResults: toolResultsText,
  });
  return { final: r2, roundsUsed: 2, toolCallsMade: calls };
}
