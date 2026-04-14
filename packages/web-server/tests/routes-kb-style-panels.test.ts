import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerKbStylePanelsRoutes } from "../src/routes/kb-style-panels.js";

function makeVault() {
  const vault = mkdtempSync(join(tmpdir(), "sp05-kb-"));
  const dir = join(vault, "08_experts", "style-panel");
  mkdirSync(dir, { recursive: true });
  return { vault, dir };
}

describe("GET /api/kb/style-panels", () => {
  it("lists all .md files with id/path/last_updated_at", async () => {
    const { vault, dir } = makeVault();
    writeFileSync(join(dir, "赛博禅心.md"), "# foo", "utf-8");
    writeFileSync(join(dir, "数字生命卡兹克.md"), "# bar", "utf-8");
    writeFileSync(join(dir, "README.txt"), "skip", "utf-8");
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/kb/style-panels" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; path: string; last_updated_at: string }>;
    const ids = body.map((b) => b.id).sort();
    expect(ids).toEqual(["数字生命卡兹克", "赛博禅心"]);
    expect(body[0]!.path.endsWith(".md")).toBe(true);
    expect(new Date(body[0]!.last_updated_at).toString()).not.toBe("Invalid Date");
  });

  it("returns empty array when directory missing", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sp05-kb-empty-"));
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/kb/style-panels" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe("ConfigStore reference_accounts", () => {
  it("accepts reference_accounts on agents config", async () => {
    const { createConfigStore } = await import("../src/services/config-store.js");
    const tmp = mkdtempSync(join(tmpdir(), "sp05-cfg-"));
    const cfgPath = join(tmp, "config.json");
    writeFileSync(cfgPath, JSON.stringify({
      vaultPath: tmp,
      sqlitePath: "",
      modelAdapter: { defaultCli: "claude", fallbackCli: "codex" },
      agents: {},
    }, null, 2), "utf-8");
    const cfg = createConfigStore(cfgPath);
    await cfg.update({
      agents: {
        "writer.opening": {
          cli: "claude",
          model: "opus",
          reference_accounts: ["赛博禅心"],
        },
      },
    });
    const read = cfg.current.agents?.["writer.opening"];
    expect(read?.reference_accounts).toEqual(["赛博禅心"]);
  });
});
