import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface InvokeOptions {
  agentKey: string;
  cli: "claude" | "codex";
  systemPrompt: string;
  userMessage: string;
  model?: string;
  timeout?: number;
}

export interface AgentResult {
  text: string;
  meta: { cli: string; model?: string; durationMs: number };
}

export function invokeAgent(opts: InvokeOptions): AgentResult {
  const started = Date.now();
  const timeout = opts.timeout ?? 180_000;
  const fullPrompt = opts.systemPrompt
    ? `${opts.systemPrompt}\n\n---\n\n${opts.userMessage}`
    : opts.userMessage;

  if (opts.cli === "codex") {
    const outPath = join(mkdtempSync(join(tmpdir(), "agent-")), "out.txt");
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--color", "never",
      "--ephemeral",
      "--sandbox", "read-only",
      "--output-last-message", outPath,
      ...(opts.model ? ["-m", opts.model] : []),
      fullPrompt,
    ];
    const proc = spawnSync("codex", args, { encoding: "buffer", timeout });
    if (proc.status !== 0) {
      const err = proc.stderr?.toString("utf-8") ?? "";
      try { unlinkSync(outPath); } catch {}
      throw new Error(`codex exit=${proc.status}: ${err.slice(0, 500)}`);
    }
    const text = readFileSync(outPath, "utf-8");
    try { unlinkSync(outPath); } catch {}
    return {
      text,
      meta: { cli: "codex", model: opts.model, durationMs: Date.now() - started },
    };
  }

  // claude
  const args = [
    "-p", fullPrompt,
    ...(opts.model ? ["--model", opts.model] : []),
  ];
  const proc = spawnSync("claude", args, { encoding: "buffer", timeout });
  if (proc.status !== 0) {
    const err = proc.stderr?.toString("utf-8") ?? "";
    throw new Error(`claude exit=${proc.status}: ${err.slice(0, 500)}`);
  }
  return {
    text: proc.stdout?.toString("utf-8") ?? "",
    meta: { cli: "claude", model: opts.model, durationMs: Date.now() - started },
  };
}
