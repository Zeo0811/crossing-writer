import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { appendEvent, readEvents } from "../src/services/event-log.js";

function mkStore(): ProjectStore {
  const root = mkdtempSync(join(tmpdir(), "ps-"));
  return new ProjectStore(root);
}

describe("ProjectStore", () => {
  it("creates a project dir with initial project.json", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Test Project" });
    expect(p.id).toMatch(/^test-project/);
    expect(p.status).toBe("created");
    expect(p.schema_version).toBe(1);
    const file = readFileSync(join(store.projectDir(p.id), "project.json"), "utf-8");
    expect(JSON.parse(file).name).toBe("Test Project");
  });

  it("lists existing projects sorted by updated_at desc", async () => {
    const store = mkStore();
    const a = await store.create({ name: "A" });
    await new Promise((r) => setTimeout(r, 10));
    const b = await store.create({ name: "B" });
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe("B");
    expect(list[1]!.name).toBe("A");
  });

  it("updates project fields and bumps updated_at", async () => {
    const store = mkStore();
    const p = await store.create({ name: "X" });
    const before = p.updated_at;
    await new Promise((r) => setTimeout(r, 10));
    await store.update(p.id, { status: "brief_uploaded" });
    const after = await store.get(p.id);
    expect(after!.status).toBe("brief_uploaded");
    expect(after!.updated_at).not.toBe(before);
  });

  it("generates unique id for name collisions", async () => {
    const store = mkStore();
    const a = await store.create({ name: "Same" });
    const b = await store.create({ name: "Same" });
    expect(a.id).not.toBe(b.id);
    expect(b.id).toMatch(/same-2/);
  });

  it("returns null for missing project", async () => {
    const store = mkStore();
    const p = await store.get("does-not-exist");
    expect(p).toBeNull();
  });

  it("handles Chinese names in slug", async () => {
    const store = mkStore();
    const p = await store.create({ name: "测试项目 MetaNovas" });
    expect(p.id).toMatch(/测试项目|metanovas/);
  });
});

describe("event-log", () => {
  it("appends and reads events", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ev-"));
    await appendEvent(dir, { type: "state_changed", from: "a", to: "b" });
    await appendEvent(dir, { type: "agent.started", agent: "x" });
    const events = await readEvents(dir);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("state_changed");
    expect(events[1]!.data.agent).toBe("x");
    expect(events[0]!.ts).toBeTypeOf("string");
  });

  it("readEvents returns empty array when file missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ev-"));
    const events = await readEvents(dir);
    expect(events).toEqual([]);
  });
});

describe("ProjectStore.list skip metadata", () => {
  it("ignores directories starting with _", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Keep" });
    // simulate stray metadata dirs at the root
    mkdirSync(join(store.projectDir("_archive"), "some-id"), { recursive: true });
    writeFileSync(join(store.projectDir("_archive"), "some-id", "project.json"), "{}");
    mkdirSync(store.projectDir("_tmp"), { recursive: true });
    const list = await store.list();
    expect(list.map((x) => x.id)).toEqual([p.id]);
  });
});
