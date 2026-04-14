import { describe, it, expect, beforeEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import {
  serializePanel,
  parsePanel,
  type StylePanelFrontmatter,
} from "../src/services/style-panel-types.js";

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "sp10-migrate-"));
});

describe("StylePanelStore.migrateLegacy", () => {
  it("rewrites old flat *_kb.md files with legacy frontmatter", () => {
    const base = join(vault, "08_experts", "style-panel");
    mkdirSync(base, { recursive: true });
    const legacyPath = join(base, "十字路口_kb.md");
    writeFileSync(legacyPath, "# original body\ncontent here\n", "utf-8");

    const s = new StylePanelStore(vault);
    const count = s.migrateLegacy();
    expect(count).toBe(1);

    const raw = readFileSync(legacyPath, "utf-8");
    expect(raw).toMatch(/^---\n/);
    const parsed = parsePanel(legacyPath, raw);
    expect(parsed.frontmatter.role).toBe("legacy");
    expect(parsed.frontmatter.status).toBe("active");
    expect(parsed.frontmatter.account).toBe("十字路口");
    expect(parsed.frontmatter.version).toBe(1);
    expect(parsed.frontmatter.source_article_count).toBe(0);
    expect((parsed.frontmatter as StylePanelFrontmatter & { migrated_from_sp06?: boolean }).migrated_from_sp06).toBe(true);
    expect(typeof parsed.frontmatter.created_at).toBe("string");
    expect(parsed.frontmatter.created_at.length).toBeGreaterThan(0);
    expect(parsed.body).toContain("# original body");
    expect(parsed.body).toContain("content here");
  });

  it("does NOT re-migrate files that already have role in frontmatter", () => {
    const base = join(vault, "08_experts", "style-panel", "entities");
    mkdirSync(base, { recursive: true });
    const already: StylePanelFrontmatter = {
      account: "AI.Talk",
      role: "opening",
      version: 2,
      status: "active",
      created_at: "2026-04-01T00:00:00Z",
      source_article_count: 5,
    };
    const p = join(base, "AI.Talk.md");
    const original = serializePanel(already, "# preserved body\n");
    writeFileSync(p, original, "utf-8");

    const s = new StylePanelStore(vault);
    const count = s.migrateLegacy();
    expect(count).toBe(0);
    expect(readFileSync(p, "utf-8")).toBe(original);
  });

  it("is idempotent: second call returns 0", () => {
    const base = join(vault, "08_experts", "style-panel");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "AccountA_kb.md"), "# body A\n", "utf-8");
    writeFileSync(join(base, "AccountB_kb.md"), "# body B\n", "utf-8");

    const s = new StylePanelStore(vault);
    expect(s.migrateLegacy()).toBe(2);
    expect(s.migrateLegacy()).toBe(0);
  });

  it("returns 0 when base dir missing", () => {
    const s = new StylePanelStore(vault);
    expect(s.migrateLegacy()).toBe(0);
  });

  it("strips _kb suffix from account name inferred from filename", () => {
    const base = join(vault, "08_experts", "style-panel");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "MyAccount_kb.md"), "body\n", "utf-8");
    const s = new StylePanelStore(vault);
    s.migrateLegacy();
    const raw = readFileSync(join(base, "MyAccount_kb.md"), "utf-8");
    const parsed = parsePanel(join(base, "MyAccount_kb.md"), raw);
    expect(parsed.frontmatter.account).toBe("MyAccount");
  });
});
