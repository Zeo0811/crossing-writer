import { describe, it, expect } from "vitest";
import {
  parsePanel,
  serializePanel,
  isLegacy,
  type StylePanelFrontmatter,
} from "../src/services/style-panel-types.js";

describe("style-panel-types", () => {
  const fm: StylePanelFrontmatter = {
    account: "十字路口",
    role: "opening",
    version: 2,
    status: "active",
    created_at: "2026-04-14T10:00:00Z",
    source_article_count: 42,
  };

  it("round-trips basic frontmatter + body", () => {
    const raw = serializePanel(fm, "# hello\n");
    const parsed = parsePanel("/tmp/x.md", raw);
    expect(parsed.frontmatter).toMatchObject(fm);
    expect(parsed.body.trim()).toBe("# hello");
    expect(parsed.absPath).toBe("/tmp/x.md");
  });

  it("round-trips with optional fields", () => {
    const full: StylePanelFrontmatter = {
      ...fm,
      slicer_run_id: "run-abc-123",
      composer_duration_ms: 1234,
    };
    const raw = serializePanel(full, "body here");
    const parsed = parsePanel("/tmp/y.md", raw);
    expect(parsed.frontmatter).toEqual(full);
  });

  it("throws on missing frontmatter", () => {
    expect(() => parsePanel("/tmp/x.md", "just body")).toThrow(/no frontmatter/);
  });

  it("throws on unclosed frontmatter", () => {
    expect(() => parsePanel("/tmp/x.md", "---\naccount: foo\nbody without closing")).toThrow(
      /no frontmatter/,
    );
  });

  it("isLegacy true for role=legacy", () => {
    expect(isLegacy({ ...fm, role: "legacy" })).toBe(true);
  });

  it("isLegacy false for role=opening", () => {
    expect(isLegacy(fm)).toBe(false);
  });

  it("serialized output starts with --- fence", () => {
    const raw = serializePanel(fm, "body");
    expect(raw.startsWith("---\n")).toBe(true);
    expect(raw).toContain("\n---\n\n");
  });

  it("preserves body with multiple lines and fenced content", () => {
    const body = "## Section\n\n- item 1\n- item 2\n\n```ts\nconst x = 1;\n```\n";
    const raw = serializePanel(fm, body);
    const parsed = parsePanel("/tmp/z.md", raw);
    expect(parsed.body).toBe(body);
  });
});
