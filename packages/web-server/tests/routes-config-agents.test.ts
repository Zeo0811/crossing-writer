import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerConfigAgentsRoutes } from "../src/routes/config-agents.js";
import type { AgentConfigEntry, AgentConfigStore } from "../src/services/agent-config-store.js";

function buildApp() {
  const state: Record<string, AgentConfigEntry> = {
    "writer.opening": { agentKey: "writer.opening", model: { cli: "claude" } },
  };
  const store: AgentConfigStore = {
    getAll: () => state,
    get: (k: string) => state[k] ?? null,
    set: async (k: string, cfg: AgentConfigEntry) => {
      // allowlist + cli validation (mirrors real store)
      const allow = ["writer.opening", "writer.practice", "writer.closing"];
      if (!allow.includes(k)) throw new Error(`unknown agentKey "${k}"`);
      if (cfg.model?.cli && !["claude", "codex"].includes(cfg.model.cli)) {
        throw new Error("invalid cli");
      }
      state[k] = cfg;
    },
    remove: async (k: string) => {
      delete state[k];
    },
  };
  const app = Fastify();
  registerConfigAgentsRoutes(app, { agentConfigStore: store });
  return { app, store, state };
}

describe("config-agents routes", () => {
  it("GET /api/config/agents returns map", async () => {
    const { app } = buildApp();
    const r = await app.inject({ method: "GET", url: "/api/config/agents" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.agents["writer.opening"].model.cli).toBe("claude");
  });

  it("GET /api/config/agents/:agentKey returns entry", async () => {
    const { app } = buildApp();
    const r = await app.inject({ method: "GET", url: "/api/config/agents/writer.opening" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).agentKey).toBe("writer.opening");
  });

  it("GET /api/config/agents/:agentKey 404 on missing", async () => {
    const { app } = buildApp();
    const r = await app.inject({ method: "GET", url: "/api/config/agents/writer.missing" });
    expect(r.statusCode).toBe(404);
  });

  it("PUT persists valid entry and returns ok", async () => {
    const { app, state } = buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/api/config/agents/writer.practice",
      payload: { agentKey: "writer.practice", model: { cli: "codex", model: "gpt-5" } },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
    expect(state["writer.practice"].model.cli).toBe("codex");
  });

  it("PUT rejects bad cli → 400", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/api/config/agents/writer.opening",
      payload: { agentKey: "writer.opening", model: { cli: "gpt" } },
    });
    expect(r.statusCode).toBe(400);
  });

  it("PUT rejects agentKey mismatch → 400", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/api/config/agents/writer.opening",
      payload: { agentKey: "writer.closing", model: { cli: "claude" } },
    });
    expect(r.statusCode).toBe(400);
  });

  it("PUT rejects unknown agentKey → 400", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/api/config/agents/writer.unknown",
      payload: { agentKey: "writer.unknown", model: { cli: "claude" } },
    });
    expect(r.statusCode).toBe(400);
  });
});
