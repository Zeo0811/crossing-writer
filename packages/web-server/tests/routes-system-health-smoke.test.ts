import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildApp } from "../src/server.js";

function testConfig() {
  const dir = mkdtempSync(join(tmpdir(), "sp11-cli-health-smoke-"));
  return {
    projectsDir: join(dir, "projects"),
    expertsDir: join(dir, "experts"),
    vaultPath: join(dir, "vault"),
    sqlitePath: join(dir, "kb.sqlite"),
    defaultCli: "claude",
    fallbackCli: "claude",
    agents: {},
  } as any;
}

describe("cli-health smoke", () => {
  it("is reachable from the wired server", async () => {
    const app = await buildApp(testConfig());
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/system/cli-health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("claude");
    expect(body).toHaveProperty("codex");
    expect(body.claude).toHaveProperty("status");
    expect(body.codex).toHaveProperty("status");
    await app.close();
  });
});
