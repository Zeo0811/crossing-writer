import { spawnSync } from "node:child_process";

export interface ToolCall {
  command: string;
  args: string[];
  raw: string;
}

const TOOL_BLOCK = /```tool\n([\s\S]*?)```/g;

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const match of text.matchAll(TOOL_BLOCK)) {
    const line = match[1]!.trim();
    if (!line) continue;
    const tokens = tokenize(line);
    if (!tokens.length) continue;
    calls.push({ command: tokens[0]!, args: tokens.slice(1), raw: line });
  }
  return calls;
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[1] ?? m[2]!);
  }
  return out;
}

export interface ToolResult {
  ok: boolean;
  data?: any;
  error?: string;
}

export function runCrossingKbSearch(args: string[]): ToolResult {
  const fullArgs = [...args];
  if (!fullArgs.includes("--json")) fullArgs.push("--json");
  const proc = spawnSync("crossing-kb", fullArgs, { encoding: "buffer" });
  if (proc.status !== 0) {
    return { ok: false, error: proc.stderr?.toString("utf-8") ?? "" };
  }
  try {
    const data = JSON.parse(proc.stdout?.toString("utf-8") ?? "[]");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `parse: ${String(e)}` };
  }
}
