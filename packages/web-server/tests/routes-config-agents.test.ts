import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerConfigAgentsRoutes } from "../src/routes/config-agents.js";
import type { AgentConfigEntry, AgentConfigStore } from "../src/services/agent-config-store.js";
import { createConfigStore } from "../src/services/config-store.js";

function buildApp() {
  const state: Record<string, AgentConfigEntry> = {
    "writer.opening": { agentKey: "writer.opening", promptVersion: "v1" },
  };
  const store: AgentConfigStore = {
    getAll: () => state,
    get: (k: string) => state[k] ?? null,
    set: async (k: string, cfg: AgentConfigEntry) => {
      // allowlist (mirrors real store)
      const allow = ["writer.opening", "writer.practice", "writer.closing"];
      if (!allow.includes(k)) throw new Error(`unknown agentKey "${k}"`);
      state[k] = cfg;
    },
    remove: async (k: string) => {
      delete state[k];
    },
  };

  // Minimal config.json on disk so createConfigStore can load/update defaultModel.
  const dir = mkdtempSync(join(tmpdir(), "rca-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify({
    vaultPath: "~/v",
    sqlitePath: "~/v/.i/r.sqlite",
    modelAdapter: { defaultCli: "claude", fallbackCli: "codex" },
    agents: { "brief_analyst": { cli: "claude" } },
  }, null, 2), "utf-8");
  const configStore = createConfigStore(path);

  const app = Fastify();
  registerConfigAgentsRoutes(app, { agentConfigStore: store, configStore });
  return { app, store, state, configStore };
}

describe("config-agents routes", () => {
  it("GET /api/config/agents returns map", async () => {
    const { app } = buildApp();
    const r = await app.inject({ method: "GET", url: "/api/config/agents" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.agents["writer.opening"].agentKey).toBe("writer.opening");
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
      payload: { agentKey: "writer.practice", promptVersion: "v3" },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
    expect(state["writer.practice"].promptVersion).toBe("v3");
  });

  it("PUT rejects agentKey mismatch → 400", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/api/config/agents/writer.opening",
      payload: { agentKey: "writer.closing" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("PUT rejects unknown agentKey → 400", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/api/config/agents/writer.unknown",
      payload: { agentKey: "writer.unknown" },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("GET/PATCH defaultModel on /api/config/agents", () => {
  it("GET /api/config/agents includes defaultModel", async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/config/agents" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.defaultModel).toBeDefined();
    expect(body.defaultModel.writer).toBeDefined();
    expect(body.defaultModel.other).toBeDefined();
  });

  it("PATCH { defaultModel: { writer } } persists", async () => {
    const { app, configStore } = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/config/agents",
      payload: { defaultModel: { writer: { cli: "codex", model: "gpt-5" } } },
    });
    expect(res.statusCode).toBe(200);
    expect(configStore.current.defaultModel.writer).toEqual({ cli: "codex", model: "gpt-5" });
  });

  it("PATCH preserves other tier when only writer is set", async () => {
    const { app, configStore } = buildApp();
    const otherBefore = configStore.current.defaultModel.other;
    const res = await app.inject({
      method: "PATCH",
      url: "/api/config/agents",
      payload: { defaultModel: { writer: { cli: "codex", model: "gpt-5" } } },
    });
    expect(res.statusCode).toBe(200);
    expect(configStore.current.defaultModel.writer).toEqual({ cli: "codex", model: "gpt-5" });
    expect(configStore.current.defaultModel.other).toEqual(otherBefore);
  });

  it("PATCH rejects malformed cli", async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/config/agents",
      payload: { defaultModel: { writer: { cli: "gemini" } } },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toMatch(/defaultModel\.writer\.cli/);
  });

  it("PATCH rejects non-object tier entry", async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/config/agents",
      payload: { defaultModel: { other: "claude" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH without defaultModel is a no-op and returns 200", async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/config/agents",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).ok).toBe(true);
  });
});
