import { describe, it, expect, vi } from "vitest";
import { createCliHealthProber } from "../src/services/cli-health.js";

function makeExec(map: Record<string, { stdout?: string; err?: any }>) {
  return vi.fn(async (cmd: string) => {
    const hit = map[cmd];
    if (!hit) throw Object.assign(new Error("nope"), { code: "ENOENT" });
    if (hit.err) throw hit.err;
    return { stdout: hit.stdout ?? "", stderr: "" };
  });
}

describe("createCliHealthProber", () => {
  it("marks both online with parsed version", async () => {
    const exec = makeExec({ claude: { stdout: "claude 1.4.2\n" }, codex: { stdout: "codex 0.9.1" } });
    const p = createCliHealthProber({ exec: exec as any, now: () => 1000 });
    const out = await p.probe();
    expect(out.claude.status).toBe("online");
    expect(out.claude.version).toBe("1.4.2");
    expect(out.codex.version).toBe("0.9.1");
  });

  it("treats ENOENT as offline", async () => {
    const exec = makeExec({ codex: { stdout: "0.9.1" } });
    const p = createCliHealthProber({ exec: exec as any, now: () => 2000 });
    const out = await p.probe();
    expect(out.claude.status).toBe("offline");
    expect(out.claude.error).toBe("command not found");
  });

  it("treats killed signal as timeout error", async () => {
    const err = Object.assign(new Error("x"), { killed: true, signal: "SIGTERM" });
    const exec = makeExec({ claude: { err }, codex: { stdout: "0.9.1" } });
    const p = createCliHealthProber({ exec: exec as any, now: () => 3000 });
    const out = await p.probe();
    expect(out.claude.status).toBe("error");
    expect(out.claude.error).toBe("probe timed out");
  });

  it("flags unparseable version", async () => {
    const exec = makeExec({ claude: { stdout: "hello" }, codex: { stdout: "1.0" } });
    const p = createCliHealthProber({ exec: exec as any, now: () => 4000 });
    const out = await p.probe();
    expect(out.claude.status).toBe("error");
    expect(out.claude.error).toMatch(/unexpected/);
  });

  it("caches within ttl and refetches after", async () => {
    let t = 0;
    const exec = makeExec({ claude: { stdout: "1.0.0" }, codex: { stdout: "1.0.0" } });
    const p = createCliHealthProber({ exec: exec as any, now: () => t, ttlMs: 1000 });
    await p.probe();
    await p.probe();
    expect(exec).toHaveBeenCalledTimes(2);
    t = 1001;
    await p.probe();
    expect(exec).toHaveBeenCalledTimes(4);
  });
});
