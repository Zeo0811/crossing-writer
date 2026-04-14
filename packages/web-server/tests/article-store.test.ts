import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArticleStore } from "../src/services/article-store.js";

function makeDir() { return mkdtempSync(join(tmpdir(), "sp05-as-")); }

describe("ArticleStore CRUD + merge", () => {
  it("writeSection + readSection round-trip preserves frontmatter and body", async () => {
    const dir = makeDir();
    const s = new ArticleStore(dir);
    await s.init();
    await s.writeSection("opening", {
      key: "opening",
      frontmatter: {
        section: "opening", last_agent: "writer.opening",
        last_updated_at: "2026-04-14T00:00:00Z",
        reference_accounts: ["赛博禅心"],
        cli: "claude", model: "opus",
      },
      body: "# 开头\n正文",
    });
    const read = await s.readSection("opening");
    expect(read?.frontmatter.section).toBe("opening");
    expect(read?.frontmatter.last_agent).toBe("writer.opening");
    expect(read?.frontmatter.reference_accounts).toEqual(["赛博禅心"]);
    expect(read?.body).toBe("# 开头\n正文");
  });

  it("listSections returns all sections including practice cases sorted by natural order", async () => {
    const dir = makeDir();
    const s = new ArticleStore(dir);
    await s.init();
    await s.writeSection("opening", { key: "opening", frontmatter: { section: "opening", last_agent: "a", last_updated_at: "t" }, body: "o" });
    await s.writeSection("practice.case-02", { key: "practice.case-02", frontmatter: { section: "practice.case-02", last_agent: "a", last_updated_at: "t" }, body: "2" });
    await s.writeSection("practice.case-01", { key: "practice.case-01", frontmatter: { section: "practice.case-01", last_agent: "a", last_updated_at: "t" }, body: "1" });
    await s.writeSection("closing", { key: "closing", frontmatter: { section: "closing", last_agent: "a", last_updated_at: "t" }, body: "c" });
    const list = await s.listSections();
    expect(list.map((x) => x.key)).toEqual(["opening", "practice.case-01", "practice.case-02", "closing"]);
  });

  it("rebuildFinal merges opening → practice (with transitions between) → closing with top frontmatter", async () => {
    const dir = makeDir();
    const s = new ArticleStore(dir);
    await s.init();
    await s.writeSection("opening", { key: "opening", frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "t", reference_accounts: ["A"] }, body: "OPEN" });
    await s.writeSection("practice.case-01", { key: "practice.case-01", frontmatter: { section: "practice.case-01", last_agent: "writer.practice", last_updated_at: "t" }, body: "P1" });
    await s.writeSection("practice.case-02", { key: "practice.case-02", frontmatter: { section: "practice.case-02", last_agent: "writer.practice", last_updated_at: "t" }, body: "P2" });
    await s.writeSection("transitions", { key: "transitions", frontmatter: { section: "transitions", last_agent: "practice.stitcher", last_updated_at: "t" }, body: "## transition.case-01-to-case-02\nTR12" });
    await s.writeSection("closing", { key: "closing", frontmatter: { section: "closing", last_agent: "writer.closing", last_updated_at: "t", reference_accounts: ["B"] }, body: "CLOSE" });

    const final = await s.rebuildFinal();
    expect(final).toMatch(/^---\n[\s\S]*type: article_draft[\s\S]*\n---\n/);
    expect(final).toContain("OPEN");
    expect(final).toContain("P1");
    expect(final).toContain("TR12");
    expect(final).toContain("P2");
    expect(final).toContain("CLOSE");
    expect(final.indexOf("OPEN")).toBeLessThan(final.indexOf("P1"));
    expect(final.indexOf("P1")).toBeLessThan(final.indexOf("TR12"));
    expect(final.indexOf("TR12")).toBeLessThan(final.indexOf("P2"));
    expect(final.indexOf("P2")).toBeLessThan(final.indexOf("CLOSE"));
    const onDisk = readFileSync(join(dir, "article/final.md"), "utf-8");
    expect(onDisk).toBe(final);
  });

  it("mergeFinal includes HTML marker comments between sections for editor use", async () => {
    const dir = makeDir();
    const s = new ArticleStore(dir);
    await s.init();
    await s.writeSection("opening", { key: "opening", frontmatter: { section: "opening", last_agent: "a", last_updated_at: "t" }, body: "O" });
    await s.writeSection("practice.case-01", { key: "practice.case-01", frontmatter: { section: "practice.case-01", last_agent: "a", last_updated_at: "t" }, body: "P" });
    await s.writeSection("closing", { key: "closing", frontmatter: { section: "closing", last_agent: "a", last_updated_at: "t" }, body: "C" });
    const merged = await s.mergeFinal();
    expect(merged).toContain("<!-- section:opening -->");
    expect(merged).toContain("<!-- section:practice.case-01 -->");
    expect(merged).toContain("<!-- section:closing -->");
  });
});
