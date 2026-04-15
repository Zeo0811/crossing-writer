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
  images?: string[];
  addDirs?: string[];
}

export interface AgentResult {
  text: string;
  meta: { cli: string; model?: string; durationMs: number };
}

export function invokeAgent(opts: InvokeOptions): AgentResult {
  const started = Date.now();
  const timeout = opts.timeout ?? 600_000;
  const fullPrompt = opts.systemPrompt
    ? `${opts.systemPrompt}\n\n---\n\n${opts.userMessage}`
    : opts.userMessage;

  if (opts.cli === "codex") {
    const outPath = join(mkdtempSync(join(tmpdir(), "agent-")), "out.txt");
    const imageArgs = (opts.images ?? []).map((p) => `--image=${p}`);
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--color", "never",
      "--ephemeral",
      "--sandbox", "read-only",
      "--output-last-message", outPath,
      ...imageArgs,
      ...(opts.model ? ["-m", opts.model] : []),
      fullPrompt,
    ];
    const proc = spawnSync("codex", args, { encoding: "buffer", timeout, input: "" });
    if (proc.status !== 0) {
      const stderr = proc.stderr?.toString("utf-8") ?? "";
      const stdout = proc.stdout?.toString("utf-8") ?? "";
      const detail = (stderr || stdout).trim();
      try { unlinkSync(outPath); } catch {}
      throw new Error(`codex exit=${proc.status}: ${detail.slice(0, 800) || "(no output)"}`);
    }
    const text = readFileSync(outPath, "utf-8");
    try { unlinkSync(outPath); } catch {}
    return {
      text,
      meta: { cli: "codex", model: opts.model, durationMs: Date.now() - started },
    };
  }

  // claude: embed images as @<abs_path> references in the prompt
  const images = opts.images ?? [];
  const claudePrompt = images.length
    ? `${fullPrompt}\n\n附加图片：\n${images.map((p) => `@${p}`).join("\n")}`
    : fullPrompt;
  const envVault = process.env.CROSSING_VAULT_PATH?.trim();
  const allDirs = new Set<string>();
  if (envVault) allDirs.add(envVault);
  for (const d of opts.addDirs ?? []) if (d) allDirs.add(d);
  const addDirArgs = Array.from(allDirs).flatMap((d) => ["--add-dir", d]);
  const args = [
    "-p", "-",
    // Disable all built-in tools so claude emits the prompt's required output as text instead
    // of silently using Write/Edit. Our writer-tool-runner uses a text-block tool protocol that
    // parses claude's stdout, so it is unaffected.
    "--tools", "",
    ...addDirArgs,
    ...(opts.model ? ["--model", opts.model] : []),
  ];
  const proc = spawnSync("claude", args, { encoding: "buffer", timeout, input: Buffer.from(claudePrompt, "utf-8") });
  const stdout = proc.stdout?.toString("utf-8") ?? "";
  const stderr = proc.stderr?.toString("utf-8") ?? "";
  if (proc.status !== 0) {
    const detail = (stderr || stdout).trim();
    throw new Error(`claude exit=${proc.status}: ${detail.slice(0, 800) || "(no output)"}`);
  }
  if (/^API Error:/m.test(stdout)) {
    throw new Error(`claude API error: ${stdout.trim().slice(0, 800)}`);
  }
  return {
    text: stdout,
    meta: { cli: "claude", model: opts.model, durationMs: Date.now() - started },
  };
}
