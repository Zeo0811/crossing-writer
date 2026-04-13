import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExpertRegistry } from "../src/services/expert-registry.js";

function mkRegistry() {
  const dir = mkdtempSync(join(tmpdir(), "exp-"));
  const topicDir = join(dir, "topic-panel");
  mkdirSync(join(topicDir, "experts"), { recursive: true });
  writeFileSync(
    join(topicDir, "index.yaml"),
    `experts:
  - name: A
    file: experts/A_kb.md
    active: true
    default_preselect: true
    specialty: aa
  - name: B
    file: experts/B_kb.md
    active: true
    default_preselect: false
    specialty: bb
  - name: C
    file: experts/C_kb.md
    active: false
    default_preselect: false
    specialty: cc
`,
  );
  writeFileSync(join(topicDir, "experts/A_kb.md"), "# A kb");
  writeFileSync(join(topicDir, "experts/B_kb.md"), "# B kb");
  return new ExpertRegistry(dir);
}

describe("ExpertRegistry", () => {
  it("lists active experts", () => {
    const r = mkRegistry();
    const experts = r.listActive("topic-panel");
    expect(experts.map((e) => e.name).sort()).toEqual(["A", "B"]);
  });

  it("returns default preselected names", () => {
    const r = mkRegistry();
    expect(r.defaultPreselected("topic-panel")).toEqual(["A"]);
  });

  it("reads KB contents", () => {
    const r = mkRegistry();
    const kb = r.readKb("topic-panel", "A");
    expect(kb).toMatch(/A kb/);
  });

  it("throws for unknown expert", () => {
    const r = mkRegistry();
    expect(() => r.readKb("topic-panel", "Z")).toThrow(/not found/);
  });

  it("listAll includes inactive", () => {
    const r = mkRegistry();
    expect(r.listAll("topic-panel").map((e) => e.name).sort()).toEqual(["A", "B", "C"]);
  });
});
