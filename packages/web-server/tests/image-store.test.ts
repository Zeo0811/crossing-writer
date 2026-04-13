import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageStore } from "../src/services/image-store.js";

function mkStore() {
  const dir = mkdtempSync(join(tmpdir(), "img-"));
  return { store: new ImageStore(dir), root: dir };
}

describe("ImageStore", () => {
  it("saves image with auto-named brief source", async () => {
    const { store, root } = mkStore();
    const info = await store.save({
      projectId: "p1",
      filename: "original.png",
      buffer: Buffer.from("pretend-png"),
      source: "brief",
    });
    expect(info.relPath).toBe("context/images/brief-fig-1.png");
    expect(info.absPath).toBe(join(root, "p1", "context/images/brief-fig-1.png"));
    expect(existsSync(info.absPath)).toBe(true);
  });

  it("auto-increments counter per source", async () => {
    const { store } = mkStore();
    const a = await store.save({ projectId: "p", filename: "a.png", buffer: Buffer.from("x"), source: "brief" });
    const b = await store.save({ projectId: "p", filename: "b.png", buffer: Buffer.from("x"), source: "brief" });
    const c = await store.save({ projectId: "p", filename: "c.jpg", buffer: Buffer.from("x"), source: "screenshot" });
    expect(a.relPath).toMatch(/brief-fig-1\.png$/);
    expect(b.relPath).toMatch(/brief-fig-2\.png$/);
    expect(c.relPath).toMatch(/screenshot-1\.jpg$/);
  });

  it("preserves file extension", async () => {
    const { store } = mkStore();
    const webp = await store.save({ projectId: "p", filename: "x.webp", buffer: Buffer.from("x"), source: "screenshot" });
    expect(webp.relPath).toMatch(/\.webp$/);
  });

  it("rejects unsupported extension", async () => {
    const { store } = mkStore();
    await expect(
      store.save({ projectId: "p", filename: "x.gif", buffer: Buffer.from("x"), source: "brief" }),
    ).rejects.toThrow(/unsupported/i);
  });

  it("lists images by project", async () => {
    const { store } = mkStore();
    await store.save({ projectId: "p", filename: "a.png", buffer: Buffer.from("x"), source: "brief" });
    await store.save({ projectId: "p", filename: "b.jpg", buffer: Buffer.from("x"), source: "screenshot" });
    const list = await store.list("p");
    expect(list).toHaveLength(2);
    expect(list.find((i) => i.source === "brief")).toBeDefined();
    expect(list.find((i) => i.source === "screenshot")).toBeDefined();
  });

  it("deletes image by filename", async () => {
    const { store, root } = mkStore();
    const saved = await store.save({ projectId: "p", filename: "a.png", buffer: Buffer.from("x"), source: "brief" });
    await store.delete("p", "brief-fig-1.png");
    expect(existsSync(saved.absPath)).toBe(false);
  });

  it("enforces per-project limit of 30 images", async () => {
    const { store } = mkStore();
    for (let i = 0; i < 30; i += 1) {
      await store.save({ projectId: "p", filename: "x.png", buffer: Buffer.from("x"), source: "brief" });
    }
    await expect(
      store.save({ projectId: "p", filename: "x.png", buffer: Buffer.from("x"), source: "brief" }),
    ).rejects.toThrow(/limit/i);
  });
});
