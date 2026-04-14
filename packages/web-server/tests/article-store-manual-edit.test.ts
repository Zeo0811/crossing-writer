import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArticleStore, type SectionFrontmatterExtras } from "../src/services/article-store.js";

function makeDir() { return mkdtempSync(join(tmpdir(), "sp13-as-")); }

describe("ArticleStore writeSection frontmatter passthrough (SP-13)", () => {
  it("writes and preserves manually_edited + edit_history in YAML", async () => {
    const dir = makeDir();
    const s = new ArticleStore(dir);
    await s.init();
    const extras: SectionFrontmatterExtras = {
      manually_edited: true,
      last_edited_at: "2026-04-14T10:00:00Z",
      edit_history: [{ at: "2026-04-14T10:00:00Z", kind: "manual" }],
    };
    await s.writeSection("opening", {
      key: "opening",
      frontmatter: {
        section: "opening",
        last_agent: "human",
        last_updated_at: "2026-04-14T10:00:00Z",
        ...extras,
      } as any,
      body: "x",
    });
    const raw = readFileSync(join(dir, "article", "sections", "opening.md"), "utf-8");
    expect(raw).toMatch(/manually_edited:\s*true/);
    expect(raw).toMatch(/edit_history:/);
    expect(raw).toMatch(/kind:\s*manual/);
  });

  it("round-trips extras through readSection", async () => {
    const dir = makeDir();
    const s = new ArticleStore(dir);
    await s.init();
    await s.writeSection("opening", {
      key: "opening",
      frontmatter: {
        section: "opening",
        last_agent: "human",
        last_updated_at: "t",
        manually_edited: true,
        edit_history: [{ at: "t", kind: "manual", summary: "typo fix" }],
        images: [{ url: "/api/projects/p1/images/abc.png", alt: "scene" }],
      } as any,
      body: "hello",
    });
    const read = await s.readSection("opening");
    const fm = read!.frontmatter as any;
    expect(fm.manually_edited).toBe(true);
    expect(fm.edit_history).toEqual([{ at: "t", kind: "manual", summary: "typo fix" }]);
    expect(fm.images).toEqual([{ url: "/api/projects/p1/images/abc.png", alt: "scene" }]);
    expect(read!.body).toBe("hello");
  });

  it("overwriting with new body preserves extras merged in frontmatter", async () => {
    const dir = makeDir();
    const s = new ArticleStore(dir);
    await s.init();
    await s.writeSection("opening", {
      key: "opening",
      frontmatter: {
        section: "opening",
        last_agent: "human",
        last_updated_at: "t",
        manually_edited: true,
        edit_history: [{ at: "t1", kind: "manual" }, { at: "t2", kind: "manual" }],
      } as any,
      body: "v1",
    });
    const read1 = await s.readSection("opening");
    await s.writeSection("opening", {
      key: "opening",
      frontmatter: { ...(read1!.frontmatter as any), last_updated_at: "t3" } as any,
      body: "v2",
    });
    const read2 = await s.readSection("opening");
    const fm = read2!.frontmatter as any;
    expect(fm.manually_edited).toBe(true);
    expect(fm.edit_history.length).toBe(2);
    expect(read2!.body).toBe("v2");
  });
});
