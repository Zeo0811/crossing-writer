import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeCompleteness } from "../src/services/evidence-completeness.js";

function mkCase(): string {
  const dir = mkdtempSync(join(tmpdir(), "ev-"));
  return dir;
}

describe("computeCompleteness", () => {
  it("all empty: missing all 3", () => {
    const r = computeCompleteness(mkCase());
    expect(r).toEqual({
      complete: false,
      missing: ["screenshot", "notes", "generated"],
      has_screenshot: false,
      has_notes: false,
      has_generated: false,
    });
  });

  it("only screenshot: missing notes + generated", () => {
    const dir = mkCase();
    mkdirSync(join(dir, "screenshots"));
    writeFileSync(join(dir, "screenshots", "a.png"), "x");
    const r = computeCompleteness(dir);
    expect(r.complete).toBe(false);
    expect(r.has_screenshot).toBe(true);
    expect(r.missing).toEqual(["notes", "generated"]);
  });

  it("only notes (with body): missing screenshot + generated", () => {
    const dir = mkCase();
    writeFileSync(join(dir, "notes.md"), "---\ntype: evidence_notes\n---\n\nfree text body");
    const r = computeCompleteness(dir);
    expect(r.has_notes).toBe(true);
    expect(r.missing).toEqual(["screenshot", "generated"]);
  });

  it("notes file exists but body and observations both empty: has_notes=false", () => {
    const dir = mkCase();
    writeFileSync(join(dir, "notes.md"), "---\ntype: evidence_notes\n---\n\n");
    const r = computeCompleteness(dir);
    expect(r.has_notes).toBe(false);
  });

  it("only generated: missing screenshot + notes", () => {
    const dir = mkCase();
    mkdirSync(join(dir, "generated"));
    writeFileSync(join(dir, "generated", "out.md"), "x");
    const r = computeCompleteness(dir);
    expect(r.has_generated).toBe(true);
    expect(r.missing).toEqual(["screenshot", "notes"]);
  });

  it("all three present: complete=true", () => {
    const dir = mkCase();
    mkdirSync(join(dir, "screenshots"));
    writeFileSync(join(dir, "screenshots", "a.png"), "x");
    mkdirSync(join(dir, "generated"));
    writeFileSync(join(dir, "generated", "v.mp4"), "x");
    writeFileSync(join(dir, "notes.md"), "---\ntype: evidence_notes\n---\n\nbody");
    const r = computeCompleteness(dir);
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
  });
});
