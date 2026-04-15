import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectProjectImages } from "../src/services/brief-images.js";

function mkProject() {
  const root = mkdtempSync(join(tmpdir(), "bimg-"));
  mkdirSync(join(root, "brief/images"), { recursive: true });
  mkdirSync(join(root, "context/images"), { recursive: true });
  writeFileSync(join(root, "brief/images/fig1.png"), "x");
  writeFileSync(join(root, "brief/images/fig2.jpg"), "x");
  writeFileSync(join(root, "context/images/screenshot-1.webp"), "x");
  writeFileSync(
    join(root, "brief/brief.md"),
    "![a](images/fig1.png)\n![b](/abs/remote.png)\n![c](https://x/z.png)\n",
  );
  writeFileSync(
    join(root, "brief/brief-summary.md"),
    "---\nx: 1\n---\n![s](images/fig2.jpg)\n",
  );
  writeFileSync(
    join(root, "context/product-overview.md"),
    "![o](images/screenshot-1.webp)\n",
  );
  return root;
}

describe("collectProjectImages", () => {
  it("collects images from brief/images, context/images, and markdown refs", async () => {
    const pDir = mkProject();
    const r = await collectProjectImages(pDir);
    expect(r.addDirs).toEqual([pDir]);
    expect(r.images).toContain(join(pDir, "brief/images/fig1.png"));
    expect(r.images).toContain(join(pDir, "brief/images/fig2.jpg"));
    expect(r.images).toContain(join(pDir, "context/images/screenshot-1.webp"));
    expect(r.images).toContain("/abs/remote.png");
    // deduped
    expect(new Set(r.images).size).toBe(r.images.length);
    // no http(s)
    for (const p of r.images) expect(p.startsWith("http")).toBe(false);
  });

  it("returns empty images when directories are missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "bimg-empty-"));
    const r = await collectProjectImages(root);
    expect(r.images).toEqual([]);
    expect(r.addDirs).toEqual([root]);
  });
});
