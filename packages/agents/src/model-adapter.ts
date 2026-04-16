import { spawn, spawnSync } from "node:child_process";
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

/**
 * Async spawn that runs the child process without blocking the Node event loop.
 * Feeds `input` to stdin, collects stdout+stderr, respects timeout.
 */
function runChildProcess(
  cmd: string,
  args: string[],
  opts: { input?: Buffer | string; timeout: number },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let extraErr = "";
    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stderr = Buffer.concat(stderrChunks).toString("utf-8") + (extraErr ? `\n[adapter] ${extraErr}` : "");
      resolve({
        status,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr,
      });
    };
    const timer = setTimeout(() => {
      extraErr = `killed after ${opts.timeout}ms timeout`;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      finish(null);
    }, opts.timeout);
    child.stdout?.on("data", (c) => stdoutChunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    child.stderr?.on("data", (c) => stderrChunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    child.on("error", (err) => {
      extraErr = `spawn error: ${err.message}`;
      finish(null);
    });
    child.on("close", (code, signal) => {
      if (code === null && signal) extraErr = `killed by signal ${signal}`;
      finish(code);
    });
    if (opts.input !== undefined) {
      const buf = Buffer.isBuffer(opts.input) ? opts.input : Buffer.from(opts.input, "utf-8");
      child.stdin?.on("error", (err) => {
        extraErr = `stdin error: ${err.message} (buf ${buf.length} bytes)`;
      });
      child.stdin?.end(buf);
    } else {
      child.stdin?.end();
    }
  });
}

export async function invokeAgent(opts: InvokeOptions): Promise<AgentResult> {
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
    const proc = await runChildProcess("codex", args, { timeout, input: "" });
    if (proc.status !== 0) {
      const detail = (proc.stderr || proc.stdout).trim();
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
    "--tools", images.length > 0 ? "Read" : "",
    ...addDirArgs,
    ...(opts.model ? ["--model", opts.model] : []),
  ];
  const proc = await runChildProcess("claude", args, {
    timeout,
    input: Buffer.from(claudePrompt, "utf-8"),
  });
  if (proc.status !== 0) {
    const detail = (proc.stderr || proc.stdout).trim();
    throw new Error(`claude exit=${proc.status}: ${detail.slice(0, 800) || "(no output)"}`);
  }
  if (/^API Error:/m.test(proc.stdout)) {
    throw new Error(`claude API error: ${proc.stdout.trim().slice(0, 800)}`);
  }
  return {
    text: proc.stdout,
    meta: { cli: "claude", model: opts.model, durationMs: Date.now() - started },
  };
}

// Keep spawnSync import reachable to avoid breaking consumers that may expect it; unused here.
export { spawnSync };
