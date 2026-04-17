import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { createConfigStore } from "../src/services/config-store.js";
import { registerConfigRoutes } from "../src/routes/config.js";

function mkApp() {
  const dir = mkdtempSync(join(tmpdir(), "rcfg-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify({
    vaultPath: "~/v",
    sqlitePath: "~/v/.i/r.sqlite",
    modelAdapter: { defaultCli: "claude", fallbackCli: "codex" },
    agents: { "brief_analyst": { cli: "claude", model: "sonnet" } },
  }, null, 2), "utf-8");
  const store = createConfigStore(path);
  const app = Fastify();
  registerConfigRoutes(app, { configStore: store });
  return { app, store };
}

describe("GET/PATCH /api/config/agents", () => {
  it("GET returns current config agents view", async () => {
    const { app } = mkApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/config/agents" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.defaultCli).toBe("claude");
    expect(body.fallbackCli).toBe("codex");
    expect(body.agents.brief_analyst).toEqual({ cli: "claude", model: "sonnet" });
  });

  it("PATCH updates and persists", async () => {
    const { app, store } = mkApp();
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/config/agents",
      payload: { defaultCli: "codex", agents: { "x": { cli: "claude" } } },
    });
    expect(res.statusCode).toBe(200);
    expect(store.current.defaultCli).toBe("codex");
    expect(store.current.agents.x).toEqual({ cli: "claude" });
  });

  it("PATCH 400 on invalid defaultCli", async () => {
    const { app } = mkApp();
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/config/agents",
      payload: { defaultCli: "gpt5" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/cli/i);
  });

  it("PATCH 400 on invalid agent cli", async () => {
    const { app } = mkApp();
    await app.ready();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/config/agents",
      payload: { agents: { x: { cli: "gpt5" } } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /api/config/agents — defaultModel", () => {
  it("GET includes defaultModel", async () => {
    const { app } = mkApp();
    await app.ready();
    const r = await app.inject({ method: "GET", url: "/api/config/agents" });
    const body = r.json();
    expect(body.defaultModel).toBeDefined();
    expect(body.defaultModel.writer).toBeDefined();
    expect(body.defaultModel.other).toBeDefined();
  });

  it("persists defaultModel.writer change", async () => {
    const { app } = mkApp();
    await app.ready();
    const put = await app.inject({
      method: "PATCH",
      url: "/api/config/agents",
      payload: {
        defaultModel: {
          writer: { cli: "codex", model: "gpt-5" },
        },
      },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: "/api/config/agents" });
    const body = get.json();
    expect(body.defaultModel.writer).toEqual({ cli: "codex", model: "gpt-5" });
  });

  it("preserves other tier when only writer is set", async () => {
    const { app } = mkApp();
    await app.ready();
    const before = await app.inject({ method: "GET", url: "/api/config/agents" });
    const otherBefore = before.json().defaultModel.other;

    const put = await app.inject({
      method: "PATCH",
      url: "/api/config/agents",
      payload: { defaultModel: { writer: { cli: "codex", model: "gpt-5" } } },
    });
    expect(put.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: "/api/config/agents" });
    const dm = after.json().defaultModel;
    expect(dm.writer).toEqual({ cli: "codex", model: "gpt-5" });
    expect(dm.other).toEqual(otherBefore);
  });

  it("rejects malformed cli", async () => {
    const { app } = mkApp();
    await app.ready();
    const r = await app.inject({
      method: "PATCH",
      url: "/api/config/agents",
      payload: { defaultModel: { writer: { cli: "gemini" } } },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/defaultModel\.writer\.cli/);
  });
});
