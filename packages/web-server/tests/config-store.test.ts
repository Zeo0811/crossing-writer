import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigStore } from "../src/services/config-store.js";

function writeConfig(dir: string, body: any): string {
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(body, null, 2), "utf-8");
  return path;
}

describe("createConfigStore", () => {
  it("loads initial config", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const path = writeConfig(dir, {
      vaultPath: "~/v",
      sqlitePath: "~/v/.i/r.sqlite",
      modelAdapter: { defaultCli: "claude", fallbackCli: "codex" },
      agents: { "brief_analyst": { cli: "claude", model: "sonnet" } },
    });
    const store = createConfigStore(path);
    expect(store.current.defaultCli).toBe("claude");
    expect(store.current.agents.brief_analyst).toEqual({ cli: "claude", model: "sonnet" });
  });

  it("update merges and writes back to disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const path = writeConfig(dir, {
      vaultPath: "~/v",
      sqlitePath: "~/v/.i/r.sqlite",
      modelAdapter: { defaultCli: "claude", fallbackCli: "codex" },
      agents: { "brief_analyst": { cli: "claude" } },
    });
    const store = createConfigStore(path);
    await store.update({
      defaultCli: "codex",
      agents: { "brief_analyst": { cli: "claude" }, "product_overview": { cli: "claude", model: "opus" } },
    });
    expect(store.current.defaultCli).toBe("codex");
    expect(store.current.agents.product_overview).toEqual({ cli: "claude", model: "opus" });

    const raw = JSON.parse(readFileSync(path, "utf-8"));
    expect(raw.modelAdapter.defaultCli).toBe("codex");
    expect(raw.agents.product_overview).toEqual({ cli: "claude", model: "opus" });
  });

  it("preserves unrelated fields in config.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const path = writeConfig(dir, {
      vaultPath: "~/v",
      sqlitePath: "~/v/.i/r.sqlite",
      modelAdapter: { defaultCli: "claude", fallbackCli: "codex" },
      agents: {},
      importSources: { xlsxDir: "/x", htmlDir: "/h" },
      customField: "keep me",
    });
    const store = createConfigStore(path);
    await store.update({ defaultCli: "codex" });
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    expect(raw.importSources).toEqual({ xlsxDir: "/x", htmlDir: "/h" });
    expect(raw.customField).toBe("keep me");
  });

  it("serializes concurrent updates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const path = writeConfig(dir, {
      vaultPath: "~/v",
      sqlitePath: "~/v/.i/r.sqlite",
      modelAdapter: { defaultCli: "claude", fallbackCli: "codex" },
      agents: {},
    });
    const store = createConfigStore(path);
    await Promise.all([
      store.update({ agents: { a: { cli: "claude" } } }),
      store.update({ agents: { a: { cli: "claude" }, b: { cli: "codex" } } }),
    ]);
    expect(Object.keys(store.current.agents).sort()).toEqual(["a", "b"]);
  });
});
