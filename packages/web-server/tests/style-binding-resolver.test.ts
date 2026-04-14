import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import type { StylePanel, StylePanelRole } from "../src/services/style-panel-types.js";
import {
  resolveStyleBinding,
  StyleNotBoundError,
} from "../src/services/style-binding-resolver.js";

let vault: string;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "sp10-sbr-"));
});

function makePanel(
  account: string,
  role: StylePanelRole,
  version: number,
  status: "active" | "deleted" = "active",
  body = `# ${account}/${role} v${version}\nbody-line\n`,
): StylePanel {
  return {
    frontmatter: {
      account,
      role,
      version,
      status,
      created_at: "2026-04-14T00:00:00Z",
      source_article_count: 3,
    },
    body,
    absPath: "",
  };
}

describe("resolveStyleBinding", () => {
  it("returns null when binding is undefined", async () => {
    const store = new StylePanelStore(vault);
    const out = await resolveStyleBinding(undefined, store);
    expect(out).toBeNull();
  });

  it("throws missing when no panels at all exist", async () => {
    const store = new StylePanelStore(vault);
    try {
      await resolveStyleBinding({ account: "A", role: "opening" }, store);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StyleNotBoundError);
      expect((e as StyleNotBoundError).reason).toBe("missing");
    }
  });

  it("throws deleted_only when only soft-deleted panels match", async () => {
    const store = new StylePanelStore(vault);
    store.write(makePanel("A", "opening", 1, "active"));
    store.softDelete("A", "opening", 1);
    try {
      await resolveStyleBinding({ account: "A", role: "opening" }, store);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StyleNotBoundError);
      expect((e as StyleNotBoundError).reason).toBe("deleted_only");
    }
  });

  it("throws legacy_only when only a legacy panel exists for that account", async () => {
    const store = new StylePanelStore(vault);
    // write legacy-role panel for account A
    store.write(makePanel("A", "legacy", 0, "active"));
    try {
      await resolveStyleBinding({ account: "A", role: "opening" }, store);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(StyleNotBoundError);
      expect((e as StyleNotBoundError).reason).toBe("legacy_only");
    }
  });

  it("happy path returns panel + bodyContent (frontmatter stripped)", async () => {
    const store = new StylePanelStore(vault);
    store.write(makePanel("A", "opening", 1));
    store.write(makePanel("A", "opening", 2, "active", "# latest\nhello world\n"));
    const out = await resolveStyleBinding({ account: "A", role: "opening" }, store);
    expect(out).not.toBeNull();
    expect(out!.panel.frontmatter.version).toBe(2);
    expect(out!.bodyContent).toContain("hello world");
    expect(out!.bodyContent.startsWith("---")).toBe(false);
    expect(out!.bodyContent).not.toContain("account: A");
  });
});
