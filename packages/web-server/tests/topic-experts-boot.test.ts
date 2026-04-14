import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/server.js";

function testConfig() {
  const dir = mkdtempSync(join(tmpdir(), "sp12-boot-"));
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

describe("SP-12 topic-experts boot", () => {
  it("registers topic-experts routes", async () => {
    const app = await buildApp(testConfig());
    await app.ready();

    const list = await app.inject({ method: "GET", url: "/api/topic-experts" });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body)).toEqual({ experts: [] });

    const created = await app.inject({
      method: "POST",
      url: "/api/topic-experts",
      payload: { name: "test", specialty: "x" },
    });
    expect(created.statusCode).toBe(200);

    const list2 = await app.inject({ method: "GET", url: "/api/topic-experts" });
    expect((JSON.parse(list2.body) as any).experts).toHaveLength(1);

    const bad = await app.inject({
      method: "POST",
      url: "/api/projects/p1/topic-experts/consult",
      payload: { selected: [], invokeType: "score" },
    });
    expect(bad.statusCode).toBe(400);

    await app.close();
  });
});
