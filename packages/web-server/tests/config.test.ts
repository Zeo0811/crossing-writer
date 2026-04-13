import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadServerConfig } from "../src/config.js";

describe("loadServerConfig", () => {
  it("reads and expands paths from config.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "srv-cfg-"));
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({
      vaultPath: "~/CrossingVault",
      sqlitePath: "~/CrossingVault/.index/refs.sqlite",
      modelAdapter: { defaultCli: "codex", fallbackCli: "claude" },
    }));
    const cfg = loadServerConfig(p);
    expect(cfg.vaultPath).toMatch(/CrossingVault$/);
    expect(cfg.defaultCli).toBe("codex");
    expect(cfg.fallbackCli).toBe("claude");
  });

  it("resolves project dir and experts dir under vault", () => {
    const dir = mkdtempSync(join(tmpdir(), "srv-cfg-"));
    const p = join(dir, "config.json");
    writeFileSync(p, JSON.stringify({
      vaultPath: dir,
      sqlitePath: join(dir, ".index/refs.sqlite"),
      modelAdapter: { defaultCli: "codex", fallbackCli: "claude" },
    }));
    const cfg = loadServerConfig(p);
    expect(cfg.projectsDir).toBe(join(dir, "07_projects"));
    expect(cfg.expertsDir).toBe(join(dir, "08_experts"));
    expect(cfg.configPath).toBe(p);
  });
});
