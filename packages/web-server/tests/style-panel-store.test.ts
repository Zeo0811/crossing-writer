import { describe, it, expect, beforeEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import {
  serializePanel,
  type StylePanel,
  type StylePanelRole,
} from "../src/services/style-panel-types.js";

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "sp10-store-"));
});

function panel(
  account: string,
  role: StylePanelRole,
  version: number,
  status: "active" | "deleted" = "active",
): StylePanel {
  return {
    frontmatter: {
      account,
      role,
      version,
      status,
      created_at: "2026-04-14T00:00:00Z",
      source_article_count: 10,
    },
    body: `# ${account}/${role} v${version}\n`,
    absPath: "",
  };
}

describe("StylePanelStore", () => {
  it("write returns absPath under <vault>/08_experts/style-panel/<account>/<role>-v<n>.md", () => {
    const s = new StylePanelStore(vault);
    const absPath = s.write(panel("A", "opening", 1));
    expect(absPath).toBe(
      join(vault, "08_experts", "style-panel", "A", "opening-v1.md"),
    );
    expect(existsSync(absPath)).toBe(true);
  });

  it("write persists frontmatter + body", () => {
    const s = new StylePanelStore(vault);
    const absPath = s.write(panel("A", "opening", 1));
    const raw = readFileSync(absPath, "utf-8");
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain("account: A");
    expect(raw).toContain("role: opening");
    expect(raw).toContain("version: 1");
    expect(raw).toContain("# A/opening v1");
  });

  it("list returns all panels across accounts/roles", () => {
    const s = new StylePanelStore(vault);
    s.write(panel("A", "opening", 1));
    s.write(panel("A", "opening", 2));
    s.write(panel("B", "closing", 1));
    const all = s.list();
    expect(all.length).toBe(3);
  });

  it("list returns [] when base dir missing", () => {
    const s = new StylePanelStore(vault);
    expect(s.list()).toEqual([]);
  });

  it("getLatestActive picks max version across active panels", () => {
    const s = new StylePanelStore(vault);
    s.write(panel("A", "opening", 1));
    s.write(panel("A", "opening", 3));
    s.write(panel("A", "opening", 2));
    expect(s.getLatestActive("A", "opening")!.frontmatter.version).toBe(3);
  });

  it("getLatestActive returns null when no match", () => {
    const s = new StylePanelStore(vault);
    s.write(panel("A", "opening", 1));
    expect(s.getLatestActive("A", "closing")).toBeNull();
    expect(s.getLatestActive("Nobody", "opening")).toBeNull();
  });

  it("softDelete hides panel from getLatestActive", () => {
    const s = new StylePanelStore(vault);
    s.write(panel("A", "opening", 1));
    s.write(panel("A", "opening", 2));
    expect(s.softDelete("A", "opening", 2)).toBe(true);
    expect(s.getLatestActive("A", "opening")!.frontmatter.version).toBe(1);
    // file still exists
    expect(s.list().length).toBe(2);
  });

  it("softDelete returns false if file missing", () => {
    const s = new StylePanelStore(vault);
    expect(s.softDelete("A", "opening", 99)).toBe(false);
  });

  it("hardDelete removes the file", () => {
    const s = new StylePanelStore(vault);
    const absPath = s.write(panel("A", "closing", 1));
    expect(s.hardDelete("A", "closing", 1)).toBe(true);
    expect(existsSync(absPath)).toBe(false);
    expect(s.list().length).toBe(0);
  });

  it("hardDelete returns false if file missing", () => {
    const s = new StylePanelStore(vault);
    expect(s.hardDelete("A", "closing", 1)).toBe(false);
  });

  it("list surfaces legacy top-level *.md files with role=legacy", () => {
    const base = join(vault, "08_experts", "style-panel");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "OldAccount_kb.md"), "# legacy body\n", "utf-8");
    const s = new StylePanelStore(vault);
    const found = s.list();
    const legacy = found.find((p) => p.frontmatter.role === "legacy");
    expect(legacy).toBeDefined();
    expect(legacy!.frontmatter.account).toBe("OldAccount_kb");
  });

  it("list skips unparseable nested files (warns, no throw)", () => {
    const base = join(vault, "08_experts", "style-panel", "A");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "garbage-v1.md"), "no frontmatter here", "utf-8");
    const s = new StylePanelStore(vault);
    expect(() => s.list()).not.toThrow();
  });

  it("markLegacy injects role=legacy into legacy file frontmatter", () => {
    const base = join(vault, "08_experts", "style-panel");
    mkdirSync(base, { recursive: true });
    const p = join(base, "OldAccount_kb.md");
    writeFileSync(p, "# legacy body\n", "utf-8");
    const s = new StylePanelStore(vault);
    s.markLegacy(p);
    const raw = readFileSync(p, "utf-8");
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain("role: legacy");
    expect(raw).toContain("# legacy body");
  });

  it("markLegacy overwrites role in existing frontmatter", () => {
    const s = new StylePanelStore(vault);
    const absPath = s.write(panel("A", "opening", 1));
    s.markLegacy(absPath);
    const raw = readFileSync(absPath, "utf-8");
    expect(raw).toContain("role: legacy");
    expect(raw).not.toMatch(/role: opening/);
  });
});
