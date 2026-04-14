import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@crossing/kb", async () => {
  const actual = await vi.importActual<any>("@crossing/kb");
  return {
    ...actual,
    searchWiki: vi.fn(async () => []),
    searchRaw: vi.fn(() => []),
  };
});

import { buildApp } from "../src/server.js";

function testConfig() {
  const dir = mkdtempSync(join(tmpdir(), "sp09-smoke-"));
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

describe("SP-09 route registration smoke", () => {
  it("suggest route is mounted", async () => {
    const app = await buildApp(testConfig());
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/api/writer/suggest?q=test",
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rewrite-selection route is mounted (404 for unknown project)", async () => {
    const app = await buildApp(testConfig());
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/unknown/writer/sections/opening/rewrite-selection",
      payload: { selected_text: "x", user_prompt: "y" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
