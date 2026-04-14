import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectOverrideStore } from "../src/services/project-override-store.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sp10-po-"));
  mkdirSync(join(dir, "p1"), { recursive: true });
});

describe("ProjectOverrideStore", () => {
  it("get returns null when file missing", () => {
    expect(new ProjectOverrideStore(dir).get("p1")).toBeNull();
  });

  it("set + get roundtrip", () => {
    const s = new ProjectOverrideStore(dir);
    s.set("p1", {
      agents: { "writer.opening": { model: { cli: "codex", model: "gpt-5" } } },
    });
    const got = s.get("p1")!;
    expect(got.agents["writer.opening"]!.model!.cli).toBe("codex");
    expect(got.agents["writer.opening"]!.model!.model).toBe("gpt-5");
  });

  it("set auto-creates project dir if absent", () => {
    const s = new ProjectOverrideStore(dir);
    s.set("fresh", { agents: { "writer.closing": { promptVersion: "v2" } } });
    expect(s.get("fresh")!.agents["writer.closing"]!.promptVersion).toBe("v2");
  });

  it("clear removes one agent", () => {
    const s = new ProjectOverrideStore(dir);
    s.set("p1", {
      agents: {
        "writer.opening": { model: { cli: "codex" } },
        "writer.closing": { tools: { search_raw: false } },
      },
    });
    s.clear("p1", "writer.opening");
    const o = s.get("p1")!;
    expect(o.agents["writer.opening"]).toBeUndefined();
    expect(o.agents["writer.closing"]).toBeDefined();
  });

  it("clear deletes file when last agent removed", () => {
    const s = new ProjectOverrideStore(dir);
    s.set("p1", { agents: { "writer.opening": { model: { cli: "codex" } } } });
    s.clear("p1", "writer.opening");
    expect(s.get("p1")).toBeNull();
    expect(existsSync(join(dir, "p1", "config.override.json"))).toBe(false);
  });

  it("clear is noop when agent not present", () => {
    const s = new ProjectOverrideStore(dir);
    s.set("p1", { agents: { "writer.closing": { promptVersion: "v1" } } });
    s.clear("p1", "writer.opening");
    expect(s.get("p1")!.agents["writer.closing"]).toBeDefined();
  });

  it("clear is noop when override file missing", () => {
    const s = new ProjectOverrideStore(dir);
    expect(() => s.clear("p1", "writer.opening")).not.toThrow();
  });

  it("delete removes file", () => {
    const s = new ProjectOverrideStore(dir);
    s.set("p1", { agents: { "writer.opening": {} } });
    s.delete("p1");
    expect(s.get("p1")).toBeNull();
  });

  it("delete on missing file is noop", () => {
    const s = new ProjectOverrideStore(dir);
    expect(() => s.delete("p1")).not.toThrow();
  });

  it("get returns null on malformed JSON", () => {
    const s = new ProjectOverrideStore(dir);
    writeFileSync(join(dir, "p1", "config.override.json"), "{ not json");
    expect(s.get("p1")).toBeNull();
  });
});
