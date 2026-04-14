import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

import { ProjectStore } from "../src/services/project-store.js";
import { registerWriterRoutes } from "../src/routes/writer.js";
import { pendingPinsStore, type PinEntry } from "../src/state/pending-pins.js";

async function seed() {
  const vault = mkdtempSync(join(tmpdir(), "sp08-pinned-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const p = await store.create({ name: "T" });
  const app = Fastify();
  registerWriterRoutes(app, {
    store,
    projectsDir,
    vaultPath: vault,
    sqlitePath: join(vault, "kb.sqlite"),
    configStore: { async get() { return { cli: "claude" }; } } as any,
  });
  await app.ready();
  return { app, projectId: p.id };
}

function mkPin(query: string): PinEntry {
  return {
    ok: true,
    tool: "search_wiki",
    query,
    args: {},
    hits: [],
    hits_count: 0,
    formatted: `F:${query}`,
    pinned_by: "manual:user",
  };
}

describe("GET /pinned + DELETE /pinned/:index", () => {
  beforeEach(() => { /* fresh project each seed */ });

  it("GET returns pinned list", async () => {
    const { app, projectId } = await seed();
    pendingPinsStore.push(projectId, "opening", mkPin("a"));
    pendingPinsStore.push(projectId, "opening", mkPin("b"));
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/writer/sections/opening/pinned`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pins).toHaveLength(2);
    expect(body.pins[0].query).toBe("a");
    expect(body.pins[1].query).toBe("b");
    pendingPinsStore.clear(projectId, "opening");
  });

  it("DELETE removes pin at index", async () => {
    const { app, projectId } = await seed();
    pendingPinsStore.push(projectId, "opening", mkPin("a"));
    pendingPinsStore.push(projectId, "opening", mkPin("b"));
    pendingPinsStore.push(projectId, "opening", mkPin("c"));
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/writer/sections/opening/pinned/1`,
    });
    expect(res.statusCode).toBe(200);
    const remaining = pendingPinsStore.list(projectId, "opening").map((p) => p.query);
    expect(remaining).toEqual(["a", "c"]);
    pendingPinsStore.clear(projectId, "opening");
  });

  it("DELETE invalid index is noop 200", async () => {
    const { app, projectId } = await seed();
    pendingPinsStore.push(projectId, "opening", mkPin("a"));
    const res1 = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/writer/sections/opening/pinned/99`,
    });
    expect(res1.statusCode).toBe(200);
    const res2 = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/writer/sections/opening/pinned/xyz`,
    });
    expect(res2.statusCode).toBe(200);
    expect(pendingPinsStore.list(projectId, "opening")).toHaveLength(1);
    pendingPinsStore.clear(projectId, "opening");
  });
});
