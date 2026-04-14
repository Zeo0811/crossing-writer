import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type CliStatus = "online" | "offline" | "error";

export interface CliHealthItem {
  status: CliStatus;
  version?: string;
  error?: string;
  checkedAt: string;
}

export interface CliHealthResponse {
  claude: CliHealthItem;
  codex: CliHealthItem;
}

export type ExecFileFn = (
  cmd: string,
  args: readonly string[],
  opts: { timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface CliHealthProberOptions {
  now?: () => number;
  exec?: ExecFileFn;
  ttlMs?: number;
  timeoutMs?: number;
}

export interface CliHealthProber {
  probe(): Promise<CliHealthResponse>;
}

const defaultExec: ExecFileFn = promisify(execFile) as unknown as ExecFileFn;

export function createCliHealthProber(opts: CliHealthProberOptions = {}): CliHealthProber {
  const now = opts.now ?? Date.now;
  const exec = opts.exec ?? defaultExec;
  const ttlMs = opts.ttlMs ?? 30_000;
  const timeoutMs = opts.timeoutMs ?? 2_000;

  let cache: { at: number; data: CliHealthResponse } | null = null;

  async function probeOne(cmd: "claude" | "codex"): Promise<CliHealthItem> {
    const checkedAt = new Date(now()).toISOString();
    try {
      const { stdout } = await exec(cmd, ["--version"], { timeout: timeoutMs });
      const m = /(\d+\.\d+(?:\.\d+)?)/.exec(stdout ?? "");
      if (m) {
        return { status: "online", version: m[1], checkedAt };
      }
      return { status: "error", error: "unexpected version output", checkedAt };
    } catch (raw) {
      const err = raw as { code?: string; killed?: boolean; signal?: string; message?: string };
      if (err && err.code === "ENOENT") {
        return { status: "offline", error: "command not found", checkedAt };
      }
      if (err && (err.killed || err.signal === "SIGTERM")) {
        return { status: "error", error: "probe timed out", checkedAt };
      }
      const msg = (err?.message ?? "probe failed").slice(0, 160);
      return { status: "error", error: msg, checkedAt };
    }
  }

  async function probe(): Promise<CliHealthResponse> {
    if (cache && now() - cache.at < ttlMs) {
      return cache.data;
    }
    const [claude, codex] = await Promise.all([probeOne("claude"), probeOne("codex")]);
    const data: CliHealthResponse = { claude, codex };
    cache = { at: now(), data };
    return data;
  }

  return { probe };
}
