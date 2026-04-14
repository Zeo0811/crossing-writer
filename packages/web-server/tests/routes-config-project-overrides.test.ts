import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerConfigProjectOverridesRoutes } from "../src/routes/config-project-overrides.js";
import type { ProjectOverride, ProjectOverrideStore } from "../src/services/project-override-store.js";

function buildApp(knownProjects: string[] = ["p1"]) {
  const state: Record<string, ProjectOverride> = {};
  const store: Pick<ProjectOverrideStore, "get" | "set" | "clear" | "delete"> = {
    get: (id: string) => state[id] ?? null,
    set: (id: string, o: ProjectOverride) => {
      state[id] = o;
    },
    clear: (id: string, ak: string) => {
      const cur = state[id];
      if (!cur) return;
      delete cur.agents[ak];
      if (Object.keys(cur.agents).length === 0) delete state[id];
    },
    delete: (id: string) => {
      delete state[id];
    },
  };
  const projectStore = {
    get: async (id: string) => (knownProjects.includes(id) ? { id, name: id } : null),
  };
  const app = Fastify();
  registerConfigProjectOverridesRoutes(app, {
    projectOverrideStore: store as ProjectOverrideStore,
    projectStore: projectStore as any,
  });
  return { app, state };
}

describe("project override routes", () => {
  it("GET returns {} when none", async () => {
    const { app } = buildApp();
    const r = await app.inject({ method: "GET", url: "/api/projects/p1/override" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body).toEqual({});
  });

  it("GET 404 on unknown project", async () => {
    const { app } = buildApp();
    const r = await app.inject({ method: "GET", url: "/api/projects/nope/override" });
    expect(r.statusCode).toBe(404);
  });

  it("PUT + GET roundtrip", async () => {
    const { app } = buildApp();
    const put = await app.inject({
      method: "PUT",
      url: "/api/projects/p1/override",
      payload: { agents: { "writer.opening": { model: { cli: "codex", model: "gpt-5" } } } },
    });
    expect(put.statusCode).toBe(200);
    const r = await app.inject({ method: "GET", url: "/api/projects/p1/override" });
    const body = JSON.parse(r.body);
    expect(body.agents["writer.opening"].model.cli).toBe("codex");
  });

  it("PUT 404 unknown project", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/api/projects/nope/override",
      payload: { agents: {} },
    });
    expect(r.statusCode).toBe(404);
  });

  it("PUT 400 on bad cli", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/api/projects/p1/override",
      payload: { agents: { "writer.opening": { model: { cli: "gpt" } } } },
    });
    expect(r.statusCode).toBe(400);
  });

  it("PUT 400 on bad styleBinding role", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/api/projects/p1/override",
      payload: { agents: { "writer.opening": { styleBinding: { account: "A", role: "weird" } } } },
    });
    expect(r.statusCode).toBe(400);
  });

  it("PUT 400 when agents is not object", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/api/projects/p1/override",
      payload: { agents: "nope" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("DELETE /:agentKey clears single agent", async () => {
    const { app, state } = buildApp();
    await app.inject({
      method: "PUT",
      url: "/api/projects/p1/override",
      payload: {
        agents: {
          "writer.opening": { model: { cli: "codex" } },
          "writer.closing": { model: { cli: "claude" } },
        },
      },
    });
    const r = await app.inject({
      method: "DELETE",
      url: "/api/projects/p1/override/writer.opening",
    });
    expect(r.statusCode).toBe(200);
    expect(state.p1.agents["writer.opening"]).toBeUndefined();
    expect(state.p1.agents["writer.closing"]).toBeDefined();
  });

  it("DELETE /:agentKey 404 unknown project", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: "/api/projects/nope/override/writer.opening",
    });
    expect(r.statusCode).toBe(404);
  });
});
