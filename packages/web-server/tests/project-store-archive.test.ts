import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore, ConfirmationMismatchError, ProjectConflictError } from "../src/services/project-store.js";

function mkStore(): ProjectStore {
  const root = mkdtempSync(join(tmpdir(), "ps-arc-"));
  return new ProjectStore(root);
}

describe("ProjectStore archive/restore/destroy", () => {
  it("archive() moves project dir into _archive/", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Alpha" });
    const activeDir = store.projectDir(p.id);
    expect(existsSync(activeDir)).toBe(true);
    await store.archive(p.id);
    expect(existsSync(activeDir)).toBe(false);
    expect(existsSync(store.archiveDir(p.id))).toBe(true);
    expect(await store.isArchived(p.id)).toBe(true);
  });

  it("archive() throws ProjectConflictError when target already exists", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Beta" });
    mkdirSync(store.archiveDir(p.id), { recursive: true });
    writeFileSync(join(store.archiveDir(p.id), "project.json"), "{}");
    await expect(store.archive(p.id)).rejects.toBeInstanceOf(ProjectConflictError);
  });

  it("archive() throws when project not found in active", async () => {
    const store = mkStore();
    await expect(store.archive("nope")).rejects.toThrow(/project_not_found/);
  });

  it("restore() moves archived back to active", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Gamma" });
    await store.archive(p.id);
    await store.restore(p.id);
    expect(existsSync(store.projectDir(p.id))).toBe(true);
    expect(existsSync(store.archiveDir(p.id))).toBe(false);
  });

  it("restore() throws ProjectConflictError on name collision in active", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Delta" });
    await store.archive(p.id);
    mkdirSync(store.projectDir(p.id), { recursive: true });
    writeFileSync(join(store.projectDir(p.id), "project.json"), "{}");
    await expect(store.restore(p.id)).rejects.toBeInstanceOf(ProjectConflictError);
  });

  it("destroy() with matching slug removes dir (active)", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Echo" });
    await store.destroy(p.id, { confirmSlug: p.slug });
    expect(existsSync(store.projectDir(p.id))).toBe(false);
  });

  it("destroy() with matching slug removes dir (archived)", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Foxtrot" });
    await store.archive(p.id);
    await store.destroy(p.id, { confirmSlug: p.slug });
    expect(existsSync(store.archiveDir(p.id))).toBe(false);
  });

  it("destroy() with wrong slug throws ConfirmationMismatchError and keeps dir", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Golf" });
    await expect(store.destroy(p.id, { confirmSlug: "wrong" })).rejects.toBeInstanceOf(
      ConfirmationMismatchError,
    );
    expect(existsSync(store.projectDir(p.id))).toBe(true);
  });

  it("destroy() throws project_not_found when missing in both locations", async () => {
    const store = mkStore();
    await expect(store.destroy("ghost", { confirmSlug: "ghost" })).rejects.toThrow(
      /project_not_found/,
    );
  });

  it("listArchived() returns only archived projects", async () => {
    const store = mkStore();
    const a = await store.create({ name: "Active" });
    const b = await store.create({ name: "ToArchive" });
    await store.archive(b.id);
    const archived = await store.listArchived();
    expect(archived.map((p) => p.id)).toEqual([b.id]);
    const active = await store.list();
    expect(active.map((p) => p.id)).toEqual([a.id]);
  });

  it("list() skips the _archive directory", async () => {
    const store = mkStore();
    const a = await store.create({ name: "Hotel" });
    await store.archive(a.id);
    const list = await store.list();
    expect(list).toHaveLength(0);
  });
});
