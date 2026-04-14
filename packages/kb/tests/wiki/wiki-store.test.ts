import { describe, it, expect } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "../../src/wiki/wiki-store.js";
import type { WikiFrontmatter } from "../../src/wiki/types.js";

describe("wiki-store frontmatter serde", () => {
  it("parses a basic frontmatter+body", () => {
    const raw = [
      "---",
      "type: entity",
      "title: PixVerse-C1",
      "aliases:",
      "  - PixVerse",
      "  - C1",
      "sources:",
      "  - account: 十字路口",
      "    article_id: a1",
      "    quoted: C1 的能力",
      "last_ingest: 2026-04-14T10:00:00Z",
      "---",
      "",
      "# PixVerse-C1",
      "",
      "body here",
    ].join("\n");
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.type).toBe("entity");
    expect(frontmatter.title).toBe("PixVerse-C1");
    expect(frontmatter.aliases).toEqual(["PixVerse", "C1"]);
    expect(frontmatter.sources).toHaveLength(1);
    expect(frontmatter.sources[0]!.article_id).toBe("a1");
    expect(body.trim().startsWith("# PixVerse-C1")).toBe(true);
  });

  it("serialize roundtrips", () => {
    const fm: WikiFrontmatter = {
      type: "concept",
      title: "AI 漫剧",
      aliases: ["漫剧"],
      sources: [{ account: "卡兹克", article_id: "x", quoted: "测试\"引号\"" }],
      backlinks: ["entities/PixVerse-C1.md"],
      images: [],
      last_ingest: "2026-04-14T00:00:00Z",
    };
    const body = "# AI 漫剧\n\n正文\n";
    const text = serializeFrontmatter(fm, body);
    const parsed = parseFrontmatter(text);
    expect(parsed.frontmatter.type).toBe("concept");
    expect(parsed.frontmatter.sources[0]!.quoted).toContain("引号");
    expect(parsed.frontmatter.backlinks).toEqual(["entities/PixVerse-C1.md"]);
    expect(parsed.body.trim()).toBe("# AI 漫剧\n\n正文".trim());
  });

  it("handles file without frontmatter (returns empty-ish frontmatter)", () => {
    const { frontmatter, body } = parseFrontmatter("# title\n\nbody");
    expect(frontmatter.title).toBe("");
    expect(body.startsWith("# title")).toBe(true);
  });
});

import { WikiStore } from "../../src/wiki/wiki-store.js";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tmpVault(): string {
  return mkdtempSync(join(tmpdir(), "wiki-store-"));
}

describe("WikiStore.applyPatch", () => {
  it("upsert creates a new page with frontmatter + body", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({
      op: "upsert",
      path: "entities/PixVerse-C1.md",
      frontmatter: { type: "entity", title: "PixVerse-C1", aliases: ["C1"] },
      body: "# PixVerse-C1\n\n说明\n",
    });
    const text = readFileSync(join(dir, "entities/PixVerse-C1.md"), "utf-8");
    expect(text).toContain("type: entity");
    expect(text).toContain("title: PixVerse-C1");
    expect(text).toContain("# PixVerse-C1");
  });

  it("upsert merges into existing (preserves sources/backlinks already there)", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({ op: "upsert", path: "entities/E.md", frontmatter: { type: "entity", title: "E" }, body: "v1" });
    store.applyPatch({ op: "append_source", path: "entities/E.md", source: { account: "A", article_id: "a1", quoted: "q1" } });
    store.applyPatch({ op: "upsert", path: "entities/E.md", frontmatter: { type: "entity", title: "E", aliases: ["e"] }, body: "v2" });
    const page = store.readPage("entities/E.md")!;
    expect(page.body.trim()).toBe("v2");
    expect(page.frontmatter.sources.map((s) => s.article_id)).toContain("a1");
    expect(page.frontmatter.aliases).toEqual(["e"]);
  });

  it("append_source is idempotent on same (account,article_id)", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({ op: "upsert", path: "entities/E.md", frontmatter: { type: "entity", title: "E" }, body: "x" });
    store.applyPatch({ op: "append_source", path: "entities/E.md", source: { account: "A", article_id: "a1", quoted: "q" } });
    store.applyPatch({ op: "append_source", path: "entities/E.md", source: { account: "A", article_id: "a1", quoted: "q-again" } });
    const page = store.readPage("entities/E.md")!;
    expect(page.frontmatter.sources).toHaveLength(1);
  });

  it("append_image is idempotent on same url", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({ op: "upsert", path: "entities/E.md", frontmatter: { type: "entity", title: "E" }, body: "x" });
    store.applyPatch({ op: "append_image", path: "entities/E.md", image: { url: "http://i/1.png" } });
    store.applyPatch({ op: "append_image", path: "entities/E.md", image: { url: "http://i/1.png", caption: "dup" } });
    const page = store.readPage("entities/E.md")!;
    expect(page.frontmatter.images).toHaveLength(1);
  });

  it("add_backlink also creates reverse backlink on target page", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({ op: "upsert", path: "concepts/A.md", frontmatter: { type: "concept", title: "A" }, body: "a" });
    store.applyPatch({ op: "upsert", path: "entities/B.md", frontmatter: { type: "entity", title: "B" }, body: "b" });
    store.applyPatch({ op: "add_backlink", path: "concepts/A.md", to: "entities/B.md" });
    const a = store.readPage("concepts/A.md")!;
    const b = store.readPage("entities/B.md")!;
    expect(a.frontmatter.backlinks).toContain("entities/B.md");
    expect(b.frontmatter.backlinks).toContain("concepts/A.md");
  });

  it("add_backlink skips self-reference and duplicates", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({ op: "upsert", path: "concepts/A.md", frontmatter: { type: "concept", title: "A" }, body: "a" });
    store.applyPatch({ op: "add_backlink", path: "concepts/A.md", to: "concepts/A.md" });
    store.applyPatch({ op: "upsert", path: "entities/B.md", frontmatter: { type: "entity", title: "B" }, body: "b" });
    store.applyPatch({ op: "add_backlink", path: "concepts/A.md", to: "entities/B.md" });
    store.applyPatch({ op: "add_backlink", path: "concepts/A.md", to: "entities/B.md" });
    const a = store.readPage("concepts/A.md")!;
    expect(a.frontmatter.backlinks?.filter((l) => l === "concepts/A.md") ?? []).toHaveLength(0);
    expect(a.frontmatter.backlinks?.filter((l) => l === "entities/B.md") ?? []).toHaveLength(1);
  });

  it("rejects path escaping vault (no ..)", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    expect(() => store.applyPatch({ op: "upsert", path: "../evil.md", frontmatter: { type: "entity", title: "x" }, body: "x" })).toThrow(/invalid path/i);
  });

  it("rejects path outside allowed kind folders", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    expect(() => store.applyPatch({ op: "upsert", path: "random/X.md", frontmatter: { type: "entity", title: "x" }, body: "x" })).toThrow(/invalid path/i);
  });

  it("listPages returns pages under kind dirs only", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({ op: "upsert", path: "entities/A.md", frontmatter: { type: "entity", title: "A" }, body: "a" });
    store.applyPatch({ op: "upsert", path: "concepts/B.md", frontmatter: { type: "concept", title: "B" }, body: "b" });
    const paths = store.listPages().map((p) => p.path).sort();
    expect(paths).toEqual(["concepts/B.md", "entities/A.md"]);
  });
});
