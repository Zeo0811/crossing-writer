import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "../src/services/evidence-store.js";

function mkProject(): { projectDir: string; caseIds: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "evp-"));
  mkdirSync(join(dir, "mission/case-plan"), { recursive: true });
  writeFileSync(
    join(dir, "mission/case-plan/selected-cases.md"),
    `---\ntype: case_plan\nselected_indices: [1, 3]\n---\n\n# Case 1 — A\nbody\n# Case 3 — C\nbody\n`,
    "utf-8",
  );
  return { projectDir: dir, caseIds: ["case-01", "case-03"] };
}

describe("EvidenceStore", () => {
  it("ensureCaseDirs creates 3 subdirs per case", async () => {
    const { projectDir } = mkProject();
    const store = new EvidenceStore(projectDir);
    await store.ensureCaseDirs(["case-01", "case-03"]);
    expect(existsSync(join(projectDir, "evidence/case-01/screenshots"))).toBe(true);
    expect(existsSync(join(projectDir, "evidence/case-01/recordings"))).toBe(true);
    expect(existsSync(join(projectDir, "evidence/case-01/generated"))).toBe(true);
    expect(existsSync(join(projectDir, "evidence/case-03/screenshots"))).toBe(true);
  });

  it("saveFile writes to right kind subdir + returns metadata", async () => {
    const { projectDir } = mkProject();
    const store = new EvidenceStore(projectDir);
    await store.ensureCaseDirs(["case-01"]);
    const info = await store.saveFile("case-01", "screenshot", "topology.png", Buffer.from("img"));
    expect(info.filename).toBe("topology.png");
    expect(info.relPath).toBe("evidence/case-01/screenshots/topology.png");
    expect(existsSync(join(projectDir, info.relPath))).toBe(true);
  });

  it("saveFile appends -2 / -3 on filename collision", async () => {
    const { projectDir } = mkProject();
    const store = new EvidenceStore(projectDir);
    await store.ensureCaseDirs(["case-01"]);
    await store.saveFile("case-01", "screenshot", "a.png", Buffer.from("1"));
    const info2 = await store.saveFile("case-01", "screenshot", "a.png", Buffer.from("2"));
    const info3 = await store.saveFile("case-01", "screenshot", "a.png", Buffer.from("3"));
    expect(info2.filename).toBe("a-2.png");
    expect(info3.filename).toBe("a-3.png");
  });

  it("listFiles returns metadata for one kind", async () => {
    const { projectDir } = mkProject();
    const store = new EvidenceStore(projectDir);
    await store.ensureCaseDirs(["case-01"]);
    await store.saveFile("case-01", "screenshot", "a.png", Buffer.from("xx"));
    await store.saveFile("case-01", "screenshot", "b.png", Buffer.from("yy"));
    const list = await store.listFiles("case-01", "screenshot");
    expect(list).toHaveLength(2);
    expect(list[0]!.size).toBe(2);
  });

  it("deleteFile removes a file", async () => {
    const { projectDir } = mkProject();
    const store = new EvidenceStore(projectDir);
    await store.ensureCaseDirs(["case-01"]);
    await store.saveFile("case-01", "screenshot", "a.png", Buffer.from("x"));
    await store.deleteFile("case-01", "screenshot", "a.png");
    expect(existsSync(join(projectDir, "evidence/case-01/screenshots/a.png"))).toBe(false);
  });

  it("readNotes parses frontmatter + body", async () => {
    const { projectDir } = mkProject();
    const store = new EvidenceStore(projectDir);
    await store.ensureCaseDirs(["case-01"]);
    writeFileSync(
      join(projectDir, "evidence/case-01/notes.md"),
      `---\ntype: evidence_notes\ncase_id: case-01\nduration_min: 45\nobservations:\n  - point: "x"\n    severity: major\n---\n\nfree text\n`,
      "utf-8",
    );
    const n = await store.readNotes("case-01");
    expect(n!.frontmatter.duration_min).toBe(45);
    expect(n!.body.trim()).toBe("free text");
    expect(n!.frontmatter.observations).toHaveLength(1);
  });

  it("writeNotes serializes frontmatter + body", async () => {
    const { projectDir } = mkProject();
    const store = new EvidenceStore(projectDir);
    await store.ensureCaseDirs(["case-01"]);
    await store.writeNotes("case-01", {
      frontmatter: {
        type: "evidence_notes",
        case_id: "case-01",
        duration_min: 30,
      },
      body: "my body",
    });
    const raw = readFileSync(join(projectDir, "evidence/case-01/notes.md"), "utf-8");
    expect(raw).toMatch(/^---\n/);
    expect(raw).toMatch(/duration_min: 30/);
    expect(raw).toMatch(/my body/);
  });

  it("regenerateIndex builds index.md from cases", async () => {
    const { projectDir } = mkProject();
    const store = new EvidenceStore(projectDir);
    await store.ensureCaseDirs(["case-01", "case-03"]);
    await store.saveFile("case-01", "screenshot", "x.png", Buffer.from("aaa"));
    await store.writeNotes("case-01", {
      frontmatter: { type: "evidence_notes", case_id: "case-01" },
      body: "ok",
    });
    await store.saveFile("case-01", "generated", "out.md", Buffer.from("zz"));
    const summary = await store.regenerateIndex(
      "test-proj",
      [{ caseId: "case-01", name: "A" }, { caseId: "case-03", name: "C" }],
    );
    expect(summary.cases["case-01"].completeness.complete).toBe(true);
    expect(summary.cases["case-03"].completeness.complete).toBe(false);
    expect(existsSync(join(projectDir, "evidence/index.md"))).toBe(true);
  });
});
