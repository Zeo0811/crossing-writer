import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "../../src/wiki/wiki-store.js";
import { rebuildIndex } from "../../src/wiki/index-maintainer.js";

function seed(): string {
  const dir = mkdtempSync(join(tmpdir(), "idx-"));
  const s = new WikiStore(dir);
  s.applyPatch({ op: "upsert", path: "entities/A.md", frontmatter: { type: "entity", title: "A" }, body: "a" });
  s.applyPatch({ op: "upsert", path: "entities/B.md", frontmatter: { type: "entity", title: "B" }, body: "b" });
  s.applyPatch({ op: "upsert", path: "concepts/C.md", frontmatter: { type: "concept", title: "C" }, body: "c" });
  s.applyPatch({ op: "upsert", path: "cases/D.md", frontmatter: { type: "case", title: "D" }, body: "d" });
  s.applyPatch({ op: "add_backlink", path: "concepts/C.md", to: "entities/A.md" });
  s.applyPatch({ op: "add_backlink", path: "concepts/C.md", to: "entities/B.md" });
  return dir;
}

describe("rebuildIndex", () => {
  it("writes index.md with by-kind sections and counts", () => {
    const dir = seed();
    rebuildIndex(dir);
    const text = readFileSync(join(dir, "index.md"), "utf-8");
    expect(text).toMatch(/# Wiki Index/);
    expect(text).toMatch(/## entities \(2\)/);
    expect(text).toMatch(/## concepts \(1\)/);
    expect(text).toMatch(/## cases \(1\)/);
    expect(text).toContain("[A](entities/A.md)");
    expect(text).toContain("[C](concepts/C.md)");
  });

  it("includes by-backlink-heat ranking section", () => {
    const dir = seed();
    rebuildIndex(dir);
    const text = readFileSync(join(dir, "index.md"), "utf-8");
    expect(text).toMatch(/## 热度（按 backlink 数）/);
    const heatSection = text.split("## 热度（按 backlink 数）")[1] ?? "";
    expect(heatSection.indexOf("concepts/C.md")).toBeGreaterThanOrEqual(0);
  });

  it("handles empty wiki gracefully", () => {
    const dir = mkdtempSync(join(tmpdir(), "empty-idx-"));
    rebuildIndex(dir);
    const text = readFileSync(join(dir, "index.md"), "utf-8");
    expect(text).toMatch(/# Wiki Index/);
    expect(text).toMatch(/## entities \(0\)/);
  });
});
