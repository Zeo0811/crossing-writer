import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type AgentStreamEvent =
  | {
      type: "tool_called";
      toolName: string;
      input: unknown;
      toolUseId?: string;
    }
  | {
      type: "tool_returned";
      toolUseId?: string;
      resultPreview?: string;
      isError?: boolean;
    };

export interface InvokeOptions {
  agentKey: string;
  cli: "claude" | "codex";
  systemPrompt: string;
  userMessage: string;
  model?: string;
  timeout?: number;
  images?: string[];
  addDirs?: string[];
  /** If set, write prompt / response / meta.json into <runLogDir>/<runId>/ */
  runLogDir?: string;
  /** Optional callback for streaming tool events (claude-only) */
  onEvent?: (ev: AgentStreamEvent) => void;
}

export interface AgentRunMeta {
  agentKey: string;
  cli: string;
  model?: string;
  startedAt: string;   // ISO
  durationMs: number;
  exit: number | null;
  promptBytes: number;
  responseBytes: number;
  stderrBytes: number;
  images?: string[];
  addDirs?: string[];
}

export interface AgentResult {
  text: string;
  meta: {
    cli: string;
    model?: string;
    durationMs: number;
    /** Relative run directory (e.g. "runs/2026-04-16T15-50-00Z-brief_analyst"), if runLogDir was set */
    runDir?: string;
  };
}

function sanitizeAgentKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function makeRunId(agentKey: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
  return `${ts}-${sanitizeAgentKey(agentKey)}`;
}

// Produce a human-readable preview for a tool_result content.
// Handles: string, array of blocks (text | image), plain object.
// For image blocks, shows "[image · <N>KB base64]" instead of the raw base64.
function summarizeToolResult(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content.slice(0, 500);
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      const b = block as any;
      if (b?.type === "text" && typeof b.text === "string") {
        parts.push(b.text);
      } else if (b?.type === "image") {
        const data = b?.source?.data;
        const kb = typeof data === "string" ? Math.round((data.length * 3) / 4 / 1024) : 0;
        parts.push(kb > 0 ? `[image · ${kb}KB base64]` : "[image]");
      } else if (b?.type === "document") {
        parts.push("[document]");
      } else {
        try { parts.push(JSON.stringify(b)); } catch { parts.push("[binary]"); }
      }
    }
    return parts.join(" ").slice(0, 500);
  }
  try { return JSON.stringify(content).slice(0, 500); } catch { return "[unserializable]"; }
}

interface ClaudeStreamResult {
  status: number | null;
  fullText: string;
  rawStdout: string;
  stderr: string;
}

function runClaudeStreaming(
  args: string[],
  input: Buffer,
  timeout: number,
  onEvent?: (ev: AgentStreamEvent) => void,
): Promise<ClaudeStreamResult> {
  return new Promise((resolve) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let rawStdout = "";
    let stderr = "";
    let fullText = "";
    let lineBuf = "";
    let settled = false;
    let extraErr = "";

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let json: any;
      try { json = JSON.parse(line); } catch { return; }
      if (json.type === "assistant" && json.message?.content) {
        for (const c of json.message.content) {
          if (c?.type === "text" && typeof c.text === "string") {
            fullText += c.text;
          } else if (c?.type === "tool_use") {
            onEvent?.({
              type: "tool_called",
              toolName: String(c.name ?? ""),
              input: c.input ?? null,
              toolUseId: c.id ? String(c.id) : undefined,
            });
          }
        }
      } else if (json.type === "user" && json.message?.content) {
        for (const c of json.message.content) {
          if (c?.type === "tool_result") {
            onEvent?.({
              type: "tool_returned",
              toolUseId: c.tool_use_id ? String(c.tool_use_id) : undefined,
              resultPreview: summarizeToolResult(c.content),
              isError: Boolean(c.is_error),
            });
          }
        }
      } else if (json.type === "result" && json.subtype === "success") {
        if (typeof json.result === "string" && json.result.length > 0) {
          fullText = json.result;
        }
      }
    };

    const finish = (status: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (lineBuf.trim()) handleLine(lineBuf);
      if (extraErr) stderr += `\n[adapter] ${extraErr}`;
      resolve({ status, fullText, rawStdout, stderr });
    };

    const timer = setTimeout(() => {
      extraErr = `killed after ${timeout}ms timeout`;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      finish(null);
    }, timeout);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
      rawStdout += text;
      lineBuf += text;
      let nlIdx: number;
      while ((nlIdx = lineBuf.indexOf("\n")) >= 0) {
        const line = lineBuf.slice(0, nlIdx);
        lineBuf = lineBuf.slice(nlIdx + 1);
        handleLine(line);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
    });
    child.on("error", (err) => { extraErr = `spawn error: ${err.message}`; finish(null); });
    child.on("close", (code, signal) => {
      if (code === null && signal) extraErr = `killed by signal ${signal}`;
      finish(code);
    });
    child.stdin?.on("error", (err) => { extraErr = `stdin error: ${err.message}`; });
    child.stdin?.end(input);
  });
}

function writeRunArtifacts(
  runLogDir: string,
  runId: string,
  fullPrompt: string,
  responseText: string,
  stderr: string,
  meta: AgentRunMeta,
): void {
  try {
    const runDir = join(runLogDir, runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "prompt.txt"), fullPrompt, "utf-8");
    writeFileSync(join(runDir, "response.txt"), responseText, "utf-8");
    if (stderr) writeFileSync(join(runDir, "stderr.txt"), stderr, "utf-8");
    writeFileSync(join(runDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    /* best-effort logging; don't fail the invocation */
  }
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
  const startedMs = Date.now();
  const startedIso = new Date(startedMs).toISOString();
  // Default 20 min — opus bookend agents occasionally hit 10-minute wall when
  // thinking tokens + tool-call rounds compound. 600s was too tight.
  const timeout = opts.timeout ?? 1_200_000;
  const fullPrompt = opts.systemPrompt
    ? `${opts.systemPrompt}\n\n---\n\n${opts.userMessage}`
    : opts.userMessage;
  const runId = opts.runLogDir ? makeRunId(opts.agentKey) : undefined;
  const runDirRel = runId ? `runs/${runId}` : undefined;

  const persistRun = (
    cli: "claude" | "codex",
    effectivePrompt: string,
    responseText: string,
    stderrText: string,
    exit: number | null,
  ) => {
    if (!opts.runLogDir || !runId) return;
    const meta: AgentRunMeta = {
      agentKey: opts.agentKey,
      cli,
      model: opts.model,
      startedAt: startedIso,
      durationMs: Date.now() - startedMs,
      exit,
      promptBytes: Buffer.byteLength(effectivePrompt, "utf-8"),
      responseBytes: Buffer.byteLength(responseText, "utf-8"),
      stderrBytes: Buffer.byteLength(stderrText, "utf-8"),
      images: opts.images,
      addDirs: opts.addDirs,
    };
    writeRunArtifacts(opts.runLogDir, runId, effectivePrompt, responseText, stderrText, meta);
  };

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
      persistRun("codex", fullPrompt, proc.stdout, proc.stderr, proc.status);
      try { unlinkSync(outPath); } catch {}
      throw new Error(`codex exit=${proc.status}: ${detail.slice(0, 800) || "(no output)"}`);
    }
    const text = readFileSync(outPath, "utf-8");
    try { unlinkSync(outPath); } catch {}
    persistRun("codex", fullPrompt, text, proc.stderr, proc.status);
    return {
      text,
      meta: { cli: "codex", model: opts.model, durationMs: Date.now() - startedMs, runDir: runDirRel },
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
  // Read tool required for @path refs to trigger real vision input in Claude CLI;
  // keep it off otherwise so the agent stays sandboxed.
  // --output-format stream-json + --verbose: emit NDJSON stream so we can intercept
  //   tool_use / tool_result events live and surface them in the project console.
  const args = [
    "-p", "-",
    "--output-format", "stream-json",
    "--verbose",
    "--tools", images.length > 0 ? "Read" : "",
    ...addDirArgs,
    ...(opts.model ? ["--model", opts.model] : []),
  ];
  const stream = await runClaudeStreaming(
    args,
    Buffer.from(claudePrompt, "utf-8"),
    timeout,
    opts.onEvent,
  );
  if (stream.status !== 0) {
    const detail = (stream.stderr || stream.rawStdout).trim();
    persistRun("claude", claudePrompt, stream.rawStdout, stream.stderr, stream.status);
    throw new Error(`claude exit=${stream.status}: ${detail.slice(0, 800) || "(no output)"}`);
  }
  if (/^API Error:/m.test(stream.fullText) || /^API Error:/m.test(stream.rawStdout)) {
    persistRun("claude", claudePrompt, stream.rawStdout, stream.stderr, stream.status);
    throw new Error(`claude API error: ${(stream.fullText || stream.rawStdout).trim().slice(0, 800)}`);
  }
  if (!stream.fullText || stream.fullText.trim().length === 0) {
    const stderrHint = stream.stderr.trim().slice(0, 400);
    persistRun("claude", claudePrompt, stream.rawStdout, stream.stderr, stream.status);
    throw new Error(`claude returned empty result${stderrHint ? ` · stderr: ${stderrHint}` : ""}`);
  }
  // Write BOTH the parsed final text (response.txt) and the raw NDJSON stream (trace.ndjson)
  // for full forensic traceability. persistRun handles response.txt; trace is extra.
  persistRun("claude", claudePrompt, stream.fullText, stream.stderr, stream.status);
  if (opts.runLogDir && runId) {
    try {
      const rawPath = join(opts.runLogDir, runId, "trace.ndjson");
      writeFileSync(rawPath, stream.rawStdout, "utf-8");
    } catch { /* ignore */ }
  }
  return {
    text: stream.fullText,
    meta: { cli: "claude", model: opts.model, durationMs: Date.now() - startedMs, runDir: runDirRel },
  };
}

// Keep spawnSync import reachable to avoid breaking consumers that may expect it; unused here.
export { spawnSync };
