import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildApp } from "../src/server.js";

function testConfig() {
  const dir = mkdtempSync(join(tmpdir(), "sp10-smoke-"));
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

describe("SP-10 route registration smoke", () => {
  it("config-agents, style-panels, overrides routes are mounted", async () => {
    const app = await buildApp(testConfig());
    await app.ready();

    const agents = await app.inject({ method: "GET", url: "/api/config/agents" });
    expect(agents.statusCode).toBe(200);
    expect(JSON.parse(agents.body)).toHaveProperty("agents");

    const panels = await app.inject({ method: "GET", url: "/api/config/style-panels" });
    expect(panels.statusCode).toBe(200);
    expect(JSON.parse(panels.body)).toHaveProperty("panels");

    // unknown project id → 404 (confirms route is mounted + project-store wired)
    const override = await app.inject({
      method: "GET",
      url: "/api/projects/nonexistent-project-id/override",
    });
    expect(override.statusCode).toBe(404);

    // distill 400 on bad role (confirms route is mounted without invoking orchestrator)
    const distill = await app.inject({
      method: "POST",
      url: "/api/config/style-panels/distill",
      payload: { account: "", role: "opening" },
    });
    expect(distill.statusCode).toBe(400);

    await app.close();
  });
});
