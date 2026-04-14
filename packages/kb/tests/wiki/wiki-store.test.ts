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
