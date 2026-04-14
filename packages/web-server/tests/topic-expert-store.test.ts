import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TopicExpertStore } from "../src/services/topic-expert-store.js";

function mkVault(): string {
  const root = mkdtempSync(join(tmpdir(), "vault-"));
  mkdirSync(join(root, "08_experts/topic-panel/experts"), { recursive: true });
  return root;
}

function seedExpert(root: string, name: string, body: string, fm: Record<string, unknown> = {}) {
  const front = [
    "---",
    `name: ${name}`,
    ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`),
    "---",
    body,
  ].join("\n");
  writeFileSync(join(root, `08_experts/topic-panel/experts/${name}_kb.md`), front, "utf-8");
}

describe("TopicExpertStore", () => {
  let root: string;
  let commitSpy: ReturnType<typeof vi.fn>;
  let store: TopicExpertStore;

  beforeEach(() => {
    root = mkVault();
    commitSpy = vi.fn().mockResolvedValue(undefined);
    store = new TopicExpertStore(root, { commit: commitSpy });
  });

  it("bootstrap empty index from two seeded _kb.md files", async () => {
    seedExpert(root, "alice", "## A", { specialty: "禅心" });
    seedExpert(root, "bob", "## B", { specialty: "硬核" });
    const list = await store.list();
    expect(list).toHaveLength(2);
    const names = list.map((e) => e.name).sort();
    expect(names).toEqual(["alice", "bob"]);
    for (const e of list) {
      expect(e.active).toBe(true);
      expect(e.default_preselect).toBe(false);
      expect(e.soft_deleted).toBe(false);
    }
  });

  it("list reflects index entries", async () => {
    seedExpert(root, "alice", "## A");
    const l1 = await store.list();
    expect(l1).toHaveLength(1);
  });

  it("get returns merged detail + word_count; null for soft_deleted", async () => {
    seedExpert(root, "alice", "Hello world", { specialty: "禅心" });
    const d = await store.get("alice");
    expect(d).not.toBeNull();
    expect(d!.kb_markdown.trim()).toContain("Hello world");
    expect(d!.word_count).toBeGreaterThan(0);
    await store.softDelete("alice");
    const d2 = await store.get("alice");
    expect(d2).toBeNull();
  });

  it("set persists active toggle + specialty edit", async () => {
    seedExpert(root, "alice", "x");
    await store.set("alice", { active: false, specialty: "新" });
    const list = await store.list();
    expect(list[0]!.active).toBe(false);
    expect(list[0]!.specialty).toBe("新");
    expect(commitSpy).toHaveBeenCalled();
  });

  it("set throws when expert missing", async () => {
    await expect(store.set("none", { active: false })).rejects.toThrow(/not found/);
  });

  it("writeKb preserves frontmatter", async () => {
    seedExpert(root, "alice", "body-original", { specialty: "zen" });
    await store.writeKb("alice", "new body content");
    const d = await store.get("alice");
    expect(d!.kb_markdown).toContain("new body content");
    const raw = readFileSync(join(root, "08_experts/topic-panel/experts/alice_kb.md"), "utf-8");
    expect(raw).toMatch(/specialty:/);
  });

  it("create duplicate throws", async () => {
    await store.create("alice", "zen");
    await expect(store.create("ALICE", "zen")).rejects.toThrow(/duplicate|exists/i);
  });

  it("create appends to index and writes stub KB", async () => {
    const meta = await store.create("alice", "zen");
    expect(meta.name).toBe("alice");
    expect(meta.active).toBe(false);
    expect(existsSync(join(root, "08_experts/topic-panel/experts/alice_kb.md"))).toBe(true);
  });

  it("softDelete hides from get", async () => {
    seedExpert(root, "alice", "x");
    await store.softDelete("alice");
    const list = await store.list();
    expect(list[0]!.soft_deleted).toBe(true);
    const d = await store.get("alice");
    expect(d).toBeNull();
  });

  it("hardDelete moves file to .trash and removes from index", async () => {
    seedExpert(root, "alice", "x");
    await store.hardDelete("alice");
    const list = await store.list();
    expect(list.find((e) => e.name === "alice")).toBeUndefined();
    const trash = readdirSync(join(root, "08_experts/topic-panel/.trash"));
    expect(trash.some((f) => f.startsWith("alice_kb."))).toBe(true);
  });

  it("all mutations invoke commit spy", async () => {
    seedExpert(root, "alice", "x");
    commitSpy.mockClear();
    await store.set("alice", { active: false });
    await store.writeKb("alice", "new");
    await store.create("bob", "z");
    await store.softDelete("bob");
    await store.hardDelete("alice");
    expect(commitSpy.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("backupKb writes .bak copy", async () => {
    seedExpert(root, "alice", "old body");
    const p = await store.backupKb("alice");
    expect(p).not.toBeNull();
    expect(existsSync(p!)).toBe(true);
    expect(readFileSync(p!, "utf-8")).toContain("old body");
  });
});
