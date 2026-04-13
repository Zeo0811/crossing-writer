# SP-04 Evidence Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-case evidence archive (screenshots / recordings / generated media / structured notes) feeding SP-05 Writer.

**Architecture:** Pure local filesystem under `evidence/<case-id>/`; backend EvidenceStore service + 7 routes; frontend left-pane Section + right-pane intake form; 2 new states (`evidence_collecting` / `evidence_ready`); SSE-driven UI refresh; reuse SP-03.5 ActionButton/Toast/SectionStatusBadge.

**Tech Stack:** Fastify 5 (multipart with 1.5GB limit), React 19 + Tailwind 4, vitest + Testing Library, js-yaml (already transitive).

**Spec:** `docs/superpowers/specs/2026-04-13-sp04-evidence-upload-design.md`

**Branch:** `sp04` (branched fresh from main)

---

## Pre-flight

Before Task 1, create branch:

```bash
cd /Users/zeoooo/crossing-writer
git checkout main
git checkout -b sp04
```

---

## File Structure

**New files:**

```
packages/web-server/src/
├── services/
│   ├── evidence-store.ts
│   └── evidence-completeness.ts
└── routes/evidence.ts

packages/web-server/tests/
├── evidence-completeness.test.ts
├── evidence-store.test.ts
├── routes-evidence-get.test.ts
├── routes-evidence-files.test.ts
├── routes-evidence-notes.test.ts
├── routes-evidence-submit.test.ts
└── integration-sp04-e2e.test.ts

packages/web-ui/src/
├── api/evidence-client.ts
├── hooks/
│   ├── useEvidence.ts
│   └── useProjectEvidence.ts
└── components/evidence/
    ├── CaseCompletenessBadge.tsx
    ├── ScreenshotUploader.tsx
    ├── RecordingUploader.tsx
    ├── MediaUploader.tsx
    ├── NotesEditor.tsx
    ├── EvidenceIntakeForm.tsx
    └── EvidenceSection.tsx

packages/web-ui/tests/components/
├── CaseCompletenessBadge.test.tsx
├── ScreenshotUploader.test.tsx        (covers 3 uploaders via param)
├── NotesEditor.test.tsx
├── EvidenceIntakeForm.test.tsx
└── EvidenceSection.test.tsx
```

**Modified:**

```
packages/web-server/src/
├── state/state-machine.ts             — add evidence_collecting/ready + transitions
├── services/project-store.ts          — Project.evidence field
└── server.ts                          — multipart limit 1.5GB, mount evidence routes

packages/web-ui/src/
├── pages/ProjectWorkbench.tsx         — left section + right panel branches
├── components/status/SectionStatusBadge.tsx — SECTION_ORDER add evidence
└── hooks/useProjectStream.ts          — EVENT_TYPES add evidence.updated/submitted
```

---

## Task Index

**M1 Backend basics**
- Task 1: State machine extension
- Task 2: evidence-completeness pure function
- Task 3: EvidenceStore service

**M2 Backend routes**
- Task 4: GET routes (overview + per-case detail) + lazy state transition
- Task 5: POST file upload (multipart + size limits + conflict rename)
- Task 6: DELETE file
- Task 7: GET/PUT notes (with frontmatter validation)
- Task 8: POST submit (completeness gate + state transition)

**M3 Frontend api + hooks**
- Task 9: evidence-client.ts
- Task 10: useEvidence + useProjectEvidence hooks

**M4 Frontend components**
- Task 11: CaseCompletenessBadge
- Task 12: 3 uploaders (Screenshot / Recording / Media)
- Task 13: NotesEditor
- Task 14: EvidenceIntakeForm (composes uploaders + notes)
- Task 15: EvidenceSection (left-pane cards + submit)

**M5 Integration**
- Task 16: ProjectWorkbench integration + e2e test

---

### Task 1: State machine extension

**Files:**
- Modify: `packages/web-server/src/state/state-machine.ts`
- Modify: `packages/web-server/tests/state-machine.test.ts` (if exists; otherwise create)

- [ ] **Step 1: Read current state-machine.ts**

Current STATUSES include `case_plan_approved` (SP-03 terminal). TRANSITIONS contain `awaiting_case_selection → [case_plan_approved]`.

- [ ] **Step 2: Append failing test (or modify if file exists)**

If `tests/state-machine.test.ts` doesn't exist, create at `packages/web-server/tests/state-machine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { STATUSES, TRANSITIONS } from "../src/state/state-machine.js";

describe("state machine SP-04 extensions", () => {
  it("includes evidence_collecting and evidence_ready statuses", () => {
    expect(STATUSES).toContain("evidence_collecting");
    expect(STATUSES).toContain("evidence_ready");
  });

  it("case_plan_approved transitions to evidence_collecting", () => {
    expect(TRANSITIONS["case_plan_approved"]).toContain("evidence_collecting");
  });

  it("evidence_collecting transitions to evidence_ready", () => {
    expect(TRANSITIONS["evidence_collecting"]).toContain("evidence_ready");
  });

  it("evidence_ready can transition back to evidence_collecting", () => {
    expect(TRANSITIONS["evidence_ready"]).toContain("evidence_collecting");
  });
});
```

If a test file already exists, append the `describe("state machine SP-04 extensions", ...)` block.

- [ ] **Step 3: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/state-machine.test.ts
```

- [ ] **Step 4: Modify state-machine.ts**

Add `"evidence_collecting"` and `"evidence_ready"` to the `STATUSES` array.

In `TRANSITIONS`:
- Modify `case_plan_approved` entry (or add it if doesn't exist) to include `"evidence_collecting"`
- Add `evidence_collecting: ["evidence_ready"]`
- Add `evidence_ready: ["evidence_collecting"]`

- [ ] **Step 5: Run tests, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/state-machine.test.ts
```

Then run full suite to confirm no SP-03 test regression:

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/state/state-machine.ts \
        packages/web-server/tests/state-machine.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): state machine evidence_collecting/ready"
```

---

### Task 2: evidence-completeness pure function

**Files:**
- Create: `packages/web-server/src/services/evidence-completeness.ts`
- Create: `packages/web-server/tests/evidence-completeness.test.ts`

- [ ] **Step 1: Failing test**

```ts
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
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/evidence-completeness.test.ts
```

- [ ] **Step 3: Implement `packages/web-server/src/services/evidence-completeness.ts`**

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface CompletenessResult {
  complete: boolean;
  missing: Array<"screenshot" | "notes" | "generated">;
  has_screenshot: boolean;
  has_notes: boolean;
  has_generated: boolean;
}

function dirHasFiles(p: string): boolean {
  if (!existsSync(p)) return false;
  try {
    const entries = readdirSync(p);
    return entries.some((e) => {
      const full = join(p, e);
      return statSync(full).isFile();
    });
  } catch {
    return false;
  }
}

function notesHasContent(notesPath: string): boolean {
  if (!existsSync(notesPath)) return false;
  try {
    const raw = readFileSync(notesPath, "utf-8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return false;
    const fm = m[1] ?? "";
    const body = (m[2] ?? "").trim();
    if (body.length > 0) return true;
    // observations counted as content too
    return /observations\s*:\s*\n\s*-/.test(fm);
  } catch {
    return false;
  }
}

export function computeCompleteness(caseDir: string): CompletenessResult {
  const has_screenshot = dirHasFiles(join(caseDir, "screenshots"));
  const has_generated = dirHasFiles(join(caseDir, "generated"));
  const has_notes = notesHasContent(join(caseDir, "notes.md"));

  const missing: CompletenessResult["missing"] = [];
  if (!has_screenshot) missing.push("screenshot");
  if (!has_notes) missing.push("notes");
  if (!has_generated) missing.push("generated");

  return {
    complete: missing.length === 0,
    missing,
    has_screenshot,
    has_notes,
    has_generated,
  };
}
```

- [ ] **Step 4: Run tests, expect PASS (6/6)**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/evidence-completeness.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/services/evidence-completeness.ts \
        packages/web-server/tests/evidence-completeness.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): evidence-completeness pure fn"
```

---

### Task 3: EvidenceStore service

**Files:**
- Create: `packages/web-server/src/services/evidence-store.ts`
- Create: `packages/web-server/tests/evidence-store.test.ts`
- Modify: `packages/web-server/src/services/project-store.ts` (add `evidence` field to Project type)

- [ ] **Step 1: Failing test `packages/web-server/tests/evidence-store.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "../src/services/evidence-store.js";

function mkProject(): { projectDir: string; caseIds: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "evp-"));
  // simulate selected-cases.md presence
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
    expect(summary.cases["case-01"].complete).toBe(true);
    expect(summary.cases["case-03"].complete).toBe(false);
    expect(existsSync(join(projectDir, "evidence/index.md"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/evidence-store.test.ts
```

- [ ] **Step 3: Implement `packages/web-server/src/services/evidence-store.ts`**

```ts
import { mkdir, writeFile, readFile, unlink, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import yaml from "js-yaml";
import { computeCompleteness, type CompletenessResult } from "./evidence-completeness.js";

export type EvidenceKind = "screenshot" | "recording" | "generated";

const KIND_DIR: Record<EvidenceKind, string> = {
  screenshot: "screenshots",
  recording: "recordings",
  generated: "generated",
};

export interface FileInfo {
  filename: string;
  relPath: string;
  size: number;
  uploaded_at: string;
}

export interface NotesData {
  frontmatter: Record<string, any>;
  body: string;
}

export interface CaseSummary {
  case_id: string;
  name: string;
  completeness: CompletenessResult;
  counts: { screenshots: number; recordings: number; generated: number };
  total_bytes: number;
  notes_path: string;
}

export interface IndexSummary {
  project_id: string;
  updated_at: string;
  cases: Record<string, CaseSummary>;
  all_complete: boolean;
}

export class EvidenceStore {
  constructor(private projectDir: string) {}

  private caseDir(caseId: string): string {
    return join(this.projectDir, "evidence", caseId);
  }

  private kindDir(caseId: string, kind: EvidenceKind): string {
    return join(this.caseDir(caseId), KIND_DIR[kind]);
  }

  async ensureCaseDirs(caseIds: string[]): Promise<void> {
    for (const id of caseIds) {
      for (const kind of ["screenshot", "recording", "generated"] as EvidenceKind[]) {
        await mkdir(this.kindDir(id, kind), { recursive: true });
      }
    }
  }

  async saveFile(caseId: string, kind: EvidenceKind, filename: string, buffer: Buffer): Promise<FileInfo> {
    const dir = this.kindDir(caseId, kind);
    await mkdir(dir, { recursive: true });
    const final = await this.resolveCollision(dir, filename);
    const abs = join(dir, final);
    await writeFile(abs, buffer);
    const st = await stat(abs);
    return {
      filename: final,
      relPath: `evidence/${caseId}/${KIND_DIR[kind]}/${final}`,
      size: st.size,
      uploaded_at: new Date().toISOString(),
    };
  }

  private async resolveCollision(dir: string, filename: string): Promise<string> {
    if (!existsSync(join(dir, filename))) return filename;
    const ext = extname(filename);
    const stem = basename(filename, ext);
    let i = 2;
    while (existsSync(join(dir, `${stem}-${i}${ext}`))) i += 1;
    return `${stem}-${i}${ext}`;
  }

  async listFiles(caseId: string, kind: EvidenceKind): Promise<FileInfo[]> {
    const dir = this.kindDir(caseId, kind);
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir);
    const out: FileInfo[] = [];
    for (const name of entries) {
      const abs = join(dir, name);
      const st = await stat(abs);
      if (!st.isFile()) continue;
      out.push({
        filename: name,
        relPath: `evidence/${caseId}/${KIND_DIR[kind]}/${name}`,
        size: st.size,
        uploaded_at: st.mtime.toISOString(),
      });
    }
    return out.sort((a, b) => a.filename.localeCompare(b.filename));
  }

  async deleteFile(caseId: string, kind: EvidenceKind, filename: string): Promise<void> {
    const abs = join(this.kindDir(caseId, kind), filename);
    if (existsSync(abs)) await unlink(abs);
  }

  async readNotes(caseId: string): Promise<NotesData | null> {
    const path = join(this.caseDir(caseId), "notes.md");
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf-8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return { frontmatter: {}, body: raw };
    const frontmatter = (yaml.load(m[1]!) as Record<string, any>) ?? {};
    return { frontmatter, body: m[2] ?? "" };
  }

  async writeNotes(caseId: string, data: NotesData): Promise<void> {
    await mkdir(this.caseDir(caseId), { recursive: true });
    const fm = yaml.dump(data.frontmatter, { lineWidth: 200 }).trimEnd();
    const out = `---\n${fm}\n---\n\n${data.body}`.trimEnd() + "\n";
    await writeFile(join(this.caseDir(caseId), "notes.md"), out, "utf-8");
  }

  async regenerateIndex(
    projectId: string,
    cases: Array<{ caseId: string; name: string }>,
  ): Promise<IndexSummary> {
    const summary: IndexSummary = {
      project_id: projectId,
      updated_at: new Date().toISOString(),
      cases: {},
      all_complete: true,
    };

    for (const { caseId, name } of cases) {
      const dir = this.caseDir(caseId);
      const completeness = computeCompleteness(dir);
      const screenshots = await this.listFiles(caseId, "screenshot");
      const recordings = await this.listFiles(caseId, "recording");
      const generated = await this.listFiles(caseId, "generated");
      const counts = {
        screenshots: screenshots.length,
        recordings: recordings.length,
        generated: generated.length,
      };
      const total_bytes =
        screenshots.reduce((s, f) => s + f.size, 0) +
        recordings.reduce((s, f) => s + f.size, 0) +
        generated.reduce((s, f) => s + f.size, 0);

      summary.cases[caseId] = {
        case_id: caseId,
        name,
        completeness,
        counts,
        total_bytes,
        notes_path: `evidence/${caseId}/notes.md`,
      };
      if (!completeness.complete) summary.all_complete = false;
    }

    // write index.md
    const fm = yaml.dump({
      type: "evidence_index",
      project_id: projectId,
      updated_at: summary.updated_at,
      cases: Object.values(summary.cases).map((c) => ({
        case_id: c.case_id,
        name: c.name,
        completeness: c.completeness,
        counts: c.counts,
        total_bytes: c.total_bytes,
        notes_path: c.notes_path,
      })),
    }, { lineWidth: 200 }).trimEnd();

    const lines = [`---`, fm, `---`, ``, `# Evidence Index`, ``];
    for (const c of Object.values(summary.cases)) {
      const icon = c.completeness.complete ? "✅" : "⚠️";
      const missing = c.completeness.missing.length
        ? ` （缺：${c.completeness.missing.join(", ")}）`
        : "";
      lines.push(`## ${c.case_id} — ${c.name} ${icon}${missing}`);
      lines.push(
        `- 截图 ${c.counts.screenshots} · 录屏 ${c.counts.recordings} · 产出 ${c.counts.generated} · 总计 ${(c.total_bytes / 1024).toFixed(1)} KB`,
      );
      lines.push(``);
    }

    await mkdir(join(this.projectDir, "evidence"), { recursive: true });
    await writeFile(join(this.projectDir, "evidence", "index.md"), lines.join("\n"), "utf-8");

    return summary;
  }
}
```

- [ ] **Step 4: Add `evidence` field to Project type**

Read `packages/web-server/src/services/project-store.ts`. Find the `Project` interface, add:

```ts
evidence?: {
  cases: Record<string, {
    has_screenshot: boolean;
    has_notes: boolean;
    has_generated: boolean;
    complete: boolean;
    counts: { screenshots: number; recordings: number; generated: number };
    last_updated_at: string;
  }>;
  index_path: string;
  all_complete: boolean;
  submitted_at: string | null;
};
```

- [ ] **Step 5: Verify `js-yaml` is available**

Check `packages/web-server/package.json`. If `js-yaml` isn't a direct dep, add it:

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm add js-yaml && pnpm add -D @types/js-yaml
```

- [ ] **Step 6: Run tests, expect PASS (8/8)**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/evidence-store.test.ts
```

- [ ] **Step 7: Run full web-server suite, no regression**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 8: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/services/evidence-store.ts \
        packages/web-server/src/services/project-store.ts \
        packages/web-server/tests/evidence-store.test.ts \
        packages/web-server/package.json \
        pnpm-lock.yaml
git -c commit.gpgsign=false commit -m "feat(web-server): EvidenceStore (file CRUD + notes + index)"
```

---

### Task 4: GET routes + lazy state transition

**Files:**
- Create: `packages/web-server/src/routes/evidence.ts`
- Create: `packages/web-server/tests/routes-evidence-get.test.ts`
- Modify: `packages/web-server/src/server.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerEvidenceRoutes } from "../src/routes/evidence.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "evget-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const app = Fastify();
  registerProjectsRoutes(app, { store });
  registerEvidenceRoutes(app, { store, projectsDir });
  await app.ready();
  const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
  // seed: case_plan_approved + selected-cases.md with 2 cases
  await store.update(p.id, { status: "case_plan_approved" });
  const cpDir = join(projectsDir, p.id, "mission/case-plan");
  mkdirSync(cpDir, { recursive: true });
  writeFileSync(join(cpDir, "selected-cases.md"),
    `---\ntype: case_plan\nselected_indices: [1, 2]\n---\n\n# Case 1 — Alpha\nbody A\n# Case 2 — Beta\nbody B\n`,
    "utf-8");
  return { app, store, project: p, projectsDir };
}

describe("GET /api/projects/:id/evidence", () => {
  it("first call lazy-transitions case_plan_approved → evidence_collecting and pre-creates dirs", async () => {
    const { app, store, project } = await mkApp();
    const res = await app.inject({ method: "GET", url: `/api/projects/${project.id}/evidence` });
    expect(res.statusCode).toBe(200);
    const updated = await store.get(project.id);
    expect(updated?.status).toBe("evidence_collecting");
    const body = res.json();
    expect(body.cases).toBeDefined();
    expect(body.all_complete).toBe(false);
    expect(body.submitted_at).toBeNull();
    expect(Object.keys(body.cases).sort()).toEqual(["case-01", "case-02"]);
  });

  it("does NOT transition if status already evidence_collecting", async () => {
    const { app, store, project } = await mkApp();
    await store.update(project.id, { status: "evidence_collecting" });
    await app.inject({ method: "GET", url: `/api/projects/${project.id}/evidence` });
    const updated = await store.get(project.id);
    expect(updated?.status).toBe("evidence_collecting");
  });
});

describe("GET /api/projects/:id/evidence/:caseId", () => {
  it("returns case detail with empty file lists", async () => {
    const { app, project } = await mkApp();
    await app.inject({ method: "GET", url: `/api/projects/${project.id}/evidence` });  // trigger init
    const res = await app.inject({ method: "GET", url: `/api/projects/${project.id}/evidence/case-01` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.case_id).toBe("case-01");
    expect(body.name).toBe("Alpha");
    expect(body.screenshots).toEqual([]);
    expect(body.notes).toBeNull();
  });

  it("404 for unknown case_id", async () => {
    const { app, project } = await mkApp();
    await app.inject({ method: "GET", url: `/api/projects/${project.id}/evidence` });
    const res = await app.inject({ method: "GET", url: `/api/projects/${project.id}/evidence/case-99` });
    expect(res.statusCode).toBe(404);
  });
});
```

Save at `packages/web-server/tests/routes-evidence-get.test.ts`.

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-evidence-get.test.ts
```

- [ ] **Step 3: Implement `packages/web-server/src/routes/evidence.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { ProjectStore } from "../services/project-store.js";
import { EvidenceStore, type EvidenceKind } from "../services/evidence-store.js";
import { computeCompleteness } from "../services/evidence-completeness.js";

export interface EvidenceDeps {
  store: ProjectStore;
  projectsDir: string;
}

interface ParsedCase {
  caseId: string;
  name: string;
}

function parseSelectedCases(projectDir: string): ParsedCase[] {
  const path = join(projectDir, "mission/case-plan/selected-cases.md");
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  const re = /^# Case (\d+)\s*[—\-]?\s*(.+)$/gm;
  const out: ParsedCase[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const idx = parseInt(m[1]!, 10);
    const caseId = `case-${String(idx).padStart(2, "0")}`;
    out.push({ caseId, name: m[2]!.trim() });
  }
  return out;
}

async function buildProjectEvidence(deps: EvidenceDeps, projectId: string) {
  const projectDir = join(deps.projectsDir, projectId);
  const evStore = new EvidenceStore(projectDir);
  const cases = parseSelectedCases(projectDir);
  await evStore.ensureCaseDirs(cases.map((c) => c.caseId));
  const summary = await evStore.regenerateIndex(projectId, cases);
  const project = await deps.store.get(projectId);
  const submitted_at = project?.evidence?.submitted_at ?? null;
  // sync project.evidence cache
  const casesCache: Record<string, any> = {};
  for (const [k, v] of Object.entries(summary.cases)) {
    casesCache[k] = {
      has_screenshot: v.completeness.has_screenshot,
      has_notes: v.completeness.has_notes,
      has_generated: v.completeness.has_generated,
      complete: v.completeness.complete,
      counts: v.counts,
      last_updated_at: summary.updated_at,
    };
  }
  await deps.store.update(projectId, {
    evidence: {
      cases: casesCache,
      index_path: "evidence/index.md",
      all_complete: summary.all_complete,
      submitted_at,
    },
  });
  return { ...summary, submitted_at };
}

export function registerEvidenceRoutes(app: FastifyInstance, deps: EvidenceDeps) {
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/evidence",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      // lazy transition
      if (project.status === "case_plan_approved") {
        await deps.store.update(req.params.id, { status: "evidence_collecting" });
      }
      const summary = await buildProjectEvidence(deps, req.params.id);
      return reply.send({
        cases: summary.cases,
        all_complete: summary.all_complete,
        submitted_at: summary.submitted_at,
        index_path: "evidence/index.md",
      });
    },
  );

  app.get<{ Params: { id: string; caseId: string } }>(
    "/api/projects/:id/evidence/:caseId",
    async (req, reply) => {
      const projectDir = join(deps.projectsDir, req.params.id);
      const cases = parseSelectedCases(projectDir);
      const c = cases.find((x) => x.caseId === req.params.caseId);
      if (!c) return reply.code(404).send({ error: "case not found" });
      const evStore = new EvidenceStore(projectDir);
      const screenshots = await evStore.listFiles(req.params.caseId, "screenshot");
      const recordings = await evStore.listFiles(req.params.caseId, "recording");
      const generated = await evStore.listFiles(req.params.caseId, "generated");
      const notes = await evStore.readNotes(req.params.caseId);
      const completeness = computeCompleteness(join(projectDir, "evidence", req.params.caseId));
      return reply.send({
        case_id: c.caseId,
        name: c.name,
        screenshots,
        recordings,
        generated,
        notes,
        completeness,
      });
    },
  );
}
```

- [ ] **Step 4: Mount in `packages/web-server/src/server.ts`**

Add import:
```ts
import { registerEvidenceRoutes } from "./routes/evidence.js";
```

Inside buildApp, after registerCasePlanRoutes:
```ts
registerEvidenceRoutes(app, {
  store,
  projectsDir: configStore.current.projectsDir,
});
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

Expected: all pass (4 new + previous all green).

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/routes/evidence.ts \
        packages/web-server/src/server.ts \
        packages/web-server/tests/routes-evidence-get.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): GET /evidence + GET /evidence/:caseId (lazy state transition)"
```

---

### Task 5: POST file upload (multipart + size limits + conflict rename)

**Files:**
- Modify: `packages/web-server/src/routes/evidence.ts` (add POST)
- Modify: `packages/web-server/src/server.ts` (multipart limit 1.5GB)
- Create: `packages/web-server/tests/routes-evidence-files.test.ts`

- [ ] **Step 1: Failing test `packages/web-server/tests/routes-evidence-files.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerEvidenceRoutes } from "../src/routes/evidence.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "evup-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 1.5 * 1024 * 1024 * 1024 } });
  registerProjectsRoutes(app, { store });
  registerEvidenceRoutes(app, { store, projectsDir });
  await app.ready();
  const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
  await store.update(p.id, { status: "case_plan_approved" });
  const cpDir = join(projectsDir, p.id, "mission/case-plan");
  mkdirSync(cpDir, { recursive: true });
  writeFileSync(join(cpDir, "selected-cases.md"),
    `---\ntype: case_plan\nselected_indices: [1]\n---\n\n# Case 1 — Alpha\nbody\n`, "utf-8");
  await app.inject({ method: "GET", url: `/api/projects/${p.id}/evidence` });  // trigger init
  return { app, store, project: p, projectsDir };
}

function multipartBody(boundary: string, kind: string, filename: string, contentType: string, content: string) {
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="kind"`,
    ``,
    kind,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    ``,
    content,
    `--${boundary}--`,
    ``,
  ].join("\r\n");
}

describe("POST /evidence/:caseId/files", () => {
  it("201 on screenshot upload + returned metadata", async () => {
    const { app, project } = await mkApp();
    const boundary = "----b" + Math.random().toString(36).slice(2);
    const body = multipartBody(boundary, "screenshot", "shot.png", "image/png", "fakebytes");
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json();
    expect(data.filename).toBe("shot.png");
    expect(data.relPath).toBe("evidence/case-01/screenshots/shot.png");
    expect(data.kind).toBe("screenshot");
  });

  it("400 on invalid kind", async () => {
    const { app, project } = await mkApp();
    const boundary = "----b" + Math.random().toString(36).slice(2);
    const body = multipartBody(boundary, "audio", "x.mp3", "audio/mpeg", "x");
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 on unknown case_id", async () => {
    const { app, project } = await mkApp();
    const boundary = "----b" + Math.random().toString(36).slice(2);
    const body = multipartBody(boundary, "screenshot", "x.png", "image/png", "x");
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-99/files`,
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("conflict rename appends -2", async () => {
    const { app, project } = await mkApp();
    const boundary1 = "----b1";
    const boundary2 = "----b2";
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: multipartBody(boundary1, "screenshot", "a.png", "image/png", "first"),
      headers: { "content-type": `multipart/form-data; boundary=${boundary1}` },
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: multipartBody(boundary2, "screenshot", "a.png", "image/png", "second"),
      headers: { "content-type": `multipart/form-data; boundary=${boundary2}` },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().filename).toBe("a-2.png");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Add POST route to `evidence.ts`**

Append inside `registerEvidenceRoutes`:

```ts
import "@fastify/multipart";

const KIND_LIMITS: Record<EvidenceKind, number> = {
  screenshot: 10 * 1024 * 1024,
  recording: 100 * 1024 * 1024,
  generated: 200 * 1024 * 1024,
};
const CASE_TOTAL_LIMIT = 1024 * 1024 * 1024;

const VALID_KINDS = new Set<EvidenceKind>(["screenshot", "recording", "generated"]);

app.post<{ Params: { id: string; caseId: string } }>(
  "/api/projects/:id/evidence/:caseId/files",
  async (req, reply) => {
    const projectDir = join(deps.projectsDir, req.params.id);
    const cases = parseSelectedCases(projectDir);
    if (!cases.find((c) => c.caseId === req.params.caseId)) {
      return reply.code(404).send({ error: "case not found" });
    }
    const evStore = new EvidenceStore(projectDir);
    let kind: EvidenceKind | undefined;
    let fileData: { filename: string; buffer: Buffer } | null = null;
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const chunks: Buffer[] = [];
        for await (const c of part.file) chunks.push(c as Buffer);
        fileData = { filename: part.filename, buffer: Buffer.concat(chunks) };
      } else {
        if (part.fieldname === "kind") kind = String(part.value) as EvidenceKind;
      }
    }
    if (!fileData) return reply.code(400).send({ error: "no file" });
    if (!kind || !VALID_KINDS.has(kind)) {
      return reply.code(400).send({ error: `invalid kind: ${kind}` });
    }
    if (fileData.buffer.length > KIND_LIMITS[kind]) {
      return reply.code(413).send({ error: `${kind} exceeds limit ${KIND_LIMITS[kind]} bytes` });
    }
    // total cap
    const all = await Promise.all(
      (["screenshot", "recording", "generated"] as EvidenceKind[]).map((k) => evStore.listFiles(req.params.caseId, k)),
    );
    const currentTotal = all.flat().reduce((s, f) => s + f.size, 0);
    if (currentTotal + fileData.buffer.length > CASE_TOTAL_LIMIT) {
      return reply.code(409).send({ error: `case total exceeds ${CASE_TOTAL_LIMIT} bytes` });
    }
    const info = await evStore.saveFile(req.params.caseId, kind, fileData.filename, fileData.buffer);
    // refresh project.evidence + index
    await buildProjectEvidence(deps, req.params.id);
    return reply.code(201).send({ ...info, kind });
  },
);
```

- [ ] **Step 4: Update server.ts multipart limit**

Find the existing `app.register(multipart, ...)` call. If it doesn't have a `limits.fileSize` of at least 1.5GB, update:

```ts
await app.register(multipart, { limits: { fileSize: 1.5 * 1024 * 1024 * 1024 } });
```

If multipart isn't registered yet (unlikely; SP-03 registered it), register here.

- [ ] **Step 5: Run tests**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test
```

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/routes/evidence.ts \
        packages/web-server/src/server.ts \
        packages/web-server/tests/routes-evidence-files.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): POST /evidence/:caseId/files (multipart + size + rename)"
```

---

### Task 6: DELETE file

**Files:**
- Modify: `packages/web-server/src/routes/evidence.ts` (add DELETE)
- Modify: `packages/web-server/tests/routes-evidence-files.test.ts` (append delete tests)

- [ ] **Step 1: Append failing test to `routes-evidence-files.test.ts`**

```ts
describe("DELETE /evidence/:caseId/files/:kind/:filename", () => {
  it("204 on delete", async () => {
    const { app, project } = await mkApp();
    const boundary = "----bd";
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: multipartBody(boundary, "screenshot", "x.png", "image/png", "x"),
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/evidence/case-01/files/screenshot/x.png`,
    });
    expect(res.statusCode).toBe(204);
  });

  it("204 silent if file missing (idempotent)", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/evidence/case-01/files/screenshot/nope.png`,
    });
    expect(res.statusCode).toBe(204);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Append DELETE route to `evidence.ts`**

```ts
app.delete<{ Params: { id: string; caseId: string; kind: string; filename: string } }>(
  "/api/projects/:id/evidence/:caseId/files/:kind/:filename",
  async (req, reply) => {
    const kind = req.params.kind as EvidenceKind;
    if (!VALID_KINDS.has(kind)) return reply.code(400).send({ error: "invalid kind" });
    const projectDir = join(deps.projectsDir, req.params.id);
    const evStore = new EvidenceStore(projectDir);
    await evStore.deleteFile(req.params.caseId, kind, req.params.filename);
    await buildProjectEvidence(deps, req.params.id);
    return reply.code(204).send();
  },
);
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/routes/evidence.ts \
        packages/web-server/tests/routes-evidence-files.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): DELETE evidence file (idempotent)"
```

---

### Task 7: GET/PUT notes (frontmatter validation)

**Files:**
- Modify: `packages/web-server/src/routes/evidence.ts`
- Create: `packages/web-server/tests/routes-evidence-notes.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerEvidenceRoutes } from "../src/routes/evidence.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "evnotes-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const app = Fastify();
  await app.register(multipart);
  registerProjectsRoutes(app, { store });
  registerEvidenceRoutes(app, { store, projectsDir });
  await app.ready();
  const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
  await store.update(p.id, { status: "case_plan_approved" });
  const cpDir = join(projectsDir, p.id, "mission/case-plan");
  mkdirSync(cpDir, { recursive: true });
  writeFileSync(join(cpDir, "selected-cases.md"),
    `---\ntype: case_plan\nselected_indices: [1]\n---\n\n# Case 1 — Alpha\nbody\n`, "utf-8");
  await app.inject({ method: "GET", url: `/api/projects/${p.id}/evidence` });
  return { app, project: p };
}

describe("GET/PUT notes", () => {
  it("PUT writes valid notes, GET reads back", async () => {
    const { app, project } = await mkApp();
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
      payload: {
        frontmatter: {
          type: "evidence_notes",
          case_id: "case-01",
          duration_min: 45,
          observations: [{ point: "x", severity: "major" }],
        },
        body: "free text",
      },
    });
    expect(putRes.statusCode).toBe(200);
    const getRes = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
    });
    expect(getRes.statusCode).toBe(200);
    const data = getRes.json();
    expect(data.frontmatter.duration_min).toBe(45);
    expect(data.body.trim()).toBe("free text");
  });

  it("GET 404 if notes absent", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("PUT 400 on missing type", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
      payload: { frontmatter: { case_id: "case-01" }, body: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT 400 on case_id mismatch", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
      payload: {
        frontmatter: { type: "evidence_notes", case_id: "case-99" },
        body: "x",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT 400 on invalid severity", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
      payload: {
        frontmatter: {
          type: "evidence_notes",
          case_id: "case-01",
          observations: [{ point: "x", severity: "critical" }],
        },
        body: "",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

Save at `packages/web-server/tests/routes-evidence-notes.test.ts`.

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Append GET/PUT notes routes + validator to `evidence.ts`**

```ts
const VALID_SEVERITY = new Set(["major", "minor", "positive"]);

function validateNotesFrontmatter(fm: any, expectedCaseId: string): string | null {
  if (!fm || typeof fm !== "object") return "frontmatter required";
  if (fm.type !== "evidence_notes") return "type must be 'evidence_notes'";
  if (fm.case_id !== expectedCaseId) return `case_id must equal ${expectedCaseId}`;
  if (fm.ran_at != null && typeof fm.ran_at !== "string") return "ran_at must be string";
  if (fm.duration_min != null && (typeof fm.duration_min !== "number" || fm.duration_min < 0)) {
    return "duration_min must be non-negative number";
  }
  if (fm.quantitative != null) {
    if (typeof fm.quantitative !== "object") return "quantitative must be object";
    for (const [k, v] of Object.entries(fm.quantitative)) {
      if (k === "custom") {
        if (typeof v !== "object") return "quantitative.custom must be object";
      } else if (typeof v !== "number") {
        return `quantitative.${k} must be number`;
      }
    }
  }
  if (fm.observations != null) {
    if (!Array.isArray(fm.observations)) return "observations must be array";
    for (const [i, obs] of fm.observations.entries()) {
      if (!obs || typeof obs !== "object") return `observations[${i}] must be object`;
      if (typeof obs.point !== "string" || !obs.point) return `observations[${i}].point required`;
      if (!VALID_SEVERITY.has(obs.severity)) return `observations[${i}].severity invalid`;
      if (obs.screenshot_ref != null && typeof obs.screenshot_ref !== "string") {
        return `observations[${i}].screenshot_ref must be string`;
      }
      if (obs.generated_ref != null && typeof obs.generated_ref !== "string") {
        return `observations[${i}].generated_ref must be string`;
      }
    }
  }
  return null;
}

app.get<{ Params: { id: string; caseId: string } }>(
  "/api/projects/:id/evidence/:caseId/notes",
  async (req, reply) => {
    const projectDir = join(deps.projectsDir, req.params.id);
    const evStore = new EvidenceStore(projectDir);
    const notes = await evStore.readNotes(req.params.caseId);
    if (!notes) return reply.code(404).send({ error: "notes not found" });
    return reply.send(notes);
  },
);

app.put<{
  Params: { id: string; caseId: string };
  Body: { frontmatter: Record<string, any>; body: string };
}>(
  "/api/projects/:id/evidence/:caseId/notes",
  async (req, reply) => {
    const body = req.body ?? ({} as any);
    const err = validateNotesFrontmatter(body.frontmatter, req.params.caseId);
    if (err) return reply.code(400).send({ error: err });
    if (typeof body.body !== "string") {
      return reply.code(400).send({ error: "body must be string" });
    }
    const projectDir = join(deps.projectsDir, req.params.id);
    const evStore = new EvidenceStore(projectDir);
    await evStore.writeNotes(req.params.caseId, {
      frontmatter: body.frontmatter,
      body: body.body,
    });
    await buildProjectEvidence(deps, req.params.id);
    return reply.send({ ok: true });
  },
);
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/routes/evidence.ts \
        packages/web-server/tests/routes-evidence-notes.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): GET/PUT /evidence/:caseId/notes (with validation)"
```

---

### Task 8: POST submit (completeness gate + state transition)

**Files:**
- Modify: `packages/web-server/src/routes/evidence.ts`
- Create: `packages/web-server/tests/routes-evidence-submit.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerEvidenceRoutes } from "../src/routes/evidence.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "evsubmit-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const app = Fastify();
  await app.register(multipart);
  registerProjectsRoutes(app, { store });
  registerEvidenceRoutes(app, { store, projectsDir });
  await app.ready();
  const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
  await store.update(p.id, { status: "case_plan_approved" });
  const cpDir = join(projectsDir, p.id, "mission/case-plan");
  mkdirSync(cpDir, { recursive: true });
  writeFileSync(join(cpDir, "selected-cases.md"),
    `---\ntype: case_plan\nselected_indices: [1]\n---\n\n# Case 1 — A\nbody\n`, "utf-8");
  await app.inject({ method: "GET", url: `/api/projects/${p.id}/evidence` });
  return { app, store, project: p, projectsDir };
}

function multipartBody(boundary: string, kind: string, filename: string, contentType: string, content: string) {
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="kind"`, ``, kind,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`, ``, content,
    `--${boundary}--`, ``,
  ].join("\r\n");
}

describe("POST /evidence/submit", () => {
  it("409 when not all complete", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/submit`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().incomplete_cases).toEqual(["case-01"]);
  });

  it("200 + state transition when all complete", async () => {
    const { app, store, project } = await mkApp();
    const b1 = "----b1";
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: multipartBody(b1, "screenshot", "a.png", "image/png", "x"),
      headers: { "content-type": `multipart/form-data; boundary=${b1}` },
    });
    const b2 = "----b2";
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: multipartBody(b2, "generated", "out.md", "text/markdown", "g"),
      headers: { "content-type": `multipart/form-data; boundary=${b2}` },
    });
    await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
      payload: {
        frontmatter: { type: "evidence_notes", case_id: "case-01" },
        body: "ok",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/submit`,
    });
    expect(res.statusCode).toBe(200);
    const updated = await store.get(project.id);
    expect(updated?.status).toBe("evidence_ready");
    expect(updated?.evidence?.submitted_at).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Append submit route to `evidence.ts`**

```ts
app.post<{ Params: { id: string } }>(
  "/api/projects/:id/evidence/submit",
  async (req, reply) => {
    const summary = await buildProjectEvidence(deps, req.params.id);
    const incomplete = Object.entries(summary.cases)
      .filter(([, v]) => !v.completeness.complete)
      .map(([k]) => k);
    if (incomplete.length > 0) {
      return reply.code(409).send({
        error: "not all cases complete",
        incomplete_cases: incomplete,
      });
    }
    const submitted_at = new Date().toISOString();
    await deps.store.update(req.params.id, {
      status: "evidence_ready",
      evidence: {
        cases: (await deps.store.get(req.params.id))?.evidence?.cases ?? {},
        index_path: "evidence/index.md",
        all_complete: true,
        submitted_at,
      },
    });
    return reply.send({ ok: true });
  },
);
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-server/src/routes/evidence.ts \
        packages/web-server/tests/routes-evidence-submit.test.ts
git -c commit.gpgsign=false commit -m "feat(web-server): POST /evidence/submit (gate + state transition)"
```

---

### Task 9: Frontend evidence-client.ts

**Files:**
- Create: `packages/web-ui/src/api/evidence-client.ts`

- [ ] **Step 1: Implement `packages/web-ui/src/api/evidence-client.ts`**

```ts
export type EvidenceKind = "screenshot" | "recording" | "generated";

export interface FileInfo {
  filename: string;
  relPath: string;
  size: number;
  uploaded_at: string;
}

export interface CompletenessResult {
  complete: boolean;
  missing: Array<"screenshot" | "notes" | "generated">;
  has_screenshot: boolean;
  has_notes: boolean;
  has_generated: boolean;
}

export interface CaseDetail {
  case_id: string;
  name: string;
  screenshots: FileInfo[];
  recordings: FileInfo[];
  generated: FileInfo[];
  notes: { frontmatter: Record<string, any>; body: string } | null;
  completeness: CompletenessResult;
}

export interface ProjectEvidence {
  cases: Record<string, {
    has_screenshot: boolean;
    has_notes: boolean;
    has_generated: boolean;
    complete: boolean;
    counts: { screenshots: number; recordings: number; generated: number };
    last_updated_at: string;
  }>;
  all_complete: boolean;
  submitted_at: string | null;
  index_path: string;
}

export async function getProjectEvidence(projectId: string): Promise<ProjectEvidence> {
  const res = await fetch(`/api/projects/${projectId}/evidence`);
  if (!res.ok) throw new Error(`get evidence failed: ${res.status}`);
  const data = await res.json();
  return {
    cases: data.cases.reduce((acc: any, c: any) => {
      acc[c.case_id] = {
        has_screenshot: c.completeness.has_screenshot,
        has_notes: c.completeness.has_notes,
        has_generated: c.completeness.has_generated,
        complete: c.completeness.complete,
        counts: c.counts,
        last_updated_at: c.last_updated_at ?? data.updated_at ?? "",
      };
      return acc;
    }, {} as ProjectEvidence["cases"]),
    all_complete: data.all_complete,
    submitted_at: data.submitted_at,
    index_path: data.index_path,
  };
}

export async function getCaseEvidence(projectId: string, caseId: string): Promise<CaseDetail> {
  const res = await fetch(`/api/projects/${projectId}/evidence/${caseId}`);
  if (!res.ok) throw new Error(`get case evidence failed: ${res.status}`);
  return res.json();
}

export async function uploadEvidenceFile(
  projectId: string,
  caseId: string,
  kind: EvidenceKind,
  file: File,
): Promise<FileInfo & { kind: EvidenceKind }> {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", file);
  const res = await fetch(`/api/projects/${projectId}/evidence/${caseId}/files`, {
    method: "POST", body: fd,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `upload failed: ${res.status}`);
  }
  return res.json();
}

export async function deleteEvidenceFile(
  projectId: string,
  caseId: string,
  kind: EvidenceKind,
  filename: string,
): Promise<void> {
  const res = await fetch(
    `/api/projects/${projectId}/evidence/${caseId}/files/${kind}/${filename}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}

export async function getNotes(projectId: string, caseId: string): Promise<{ frontmatter: Record<string, any>; body: string } | null> {
  const res = await fetch(`/api/projects/${projectId}/evidence/${caseId}/notes`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get notes failed: ${res.status}`);
  return res.json();
}

export async function putNotes(
  projectId: string,
  caseId: string,
  data: { frontmatter: Record<string, any>; body: string },
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/evidence/${caseId}/notes`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `put notes failed: ${res.status}`);
  }
}

export async function submitEvidence(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/evidence/submit`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `submit failed: ${res.status}`);
  }
}
```

- [ ] **Step 2: Commit (no test for client.ts; covered by component tests)**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/api/evidence-client.ts
git -c commit.gpgsign=false commit -m "feat(web-ui): evidence-client api wrapper"
```

---

### Task 10: useEvidence + useProjectEvidence hooks

**Files:**
- Create: `packages/web-ui/src/hooks/useEvidence.ts`
- Create: `packages/web-ui/src/hooks/useProjectEvidence.ts`
- Modify: `packages/web-ui/src/hooks/useProjectStream.ts` (add evidence event types)

- [ ] **Step 1: Add events to useProjectStream EVENT_TYPES**

In `packages/web-ui/src/hooks/useProjectStream.ts`, append to `EVENT_TYPES` array:

```ts
"evidence.updated",
"evidence.submitted",
```

- [ ] **Step 2: Implement `packages/web-ui/src/hooks/useEvidence.ts`**

```ts
import { useEffect, useState, useCallback } from "react";
import { getCaseEvidence, type CaseDetail } from "../api/evidence-client";
import { useProjectStream } from "./useProjectStream";

export function useEvidence(projectId: string, caseId: string | null) {
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const { events } = useProjectStream(projectId);

  const reload = useCallback(() => {
    if (!caseId) { setDetail(null); return; }
    setLoading(true);
    getCaseEvidence(projectId, caseId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [projectId, caseId]);

  useEffect(() => { reload(); }, [reload]);

  // SSE-driven refresh: when an evidence.updated event for our caseId arrives, reload
  useEffect(() => {
    if (!caseId || events.length === 0) return;
    const last = events[events.length - 1];
    if (!last) return;
    if (last.type !== "evidence.updated") return;
    const payload = (last.data ?? last) as any;
    if (payload.case_id === caseId) reload();
  }, [events, caseId, reload]);

  return { detail, loading, reload };
}
```

- [ ] **Step 3: Implement `packages/web-ui/src/hooks/useProjectEvidence.ts`**

```ts
import { useEffect, useState, useCallback } from "react";
import { getProjectEvidence, type ProjectEvidence } from "../api/evidence-client";
import { useProjectStream } from "./useProjectStream";

export function useProjectEvidence(projectId: string) {
  const [evidence, setEvidence] = useState<ProjectEvidence | null>(null);
  const { events } = useProjectStream(projectId);

  const reload = useCallback(() => {
    getProjectEvidence(projectId)
      .then(setEvidence)
      .catch(() => setEvidence(null));
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (!last) return;
    if (last.type === "evidence.updated" || last.type === "evidence.submitted") reload();
  }, [events, reload]);

  return { evidence, reload };
}
```

- [ ] **Step 4: Run web-ui tests (no new tests; existing should still pass)**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/hooks/useEvidence.ts \
        packages/web-ui/src/hooks/useProjectEvidence.ts \
        packages/web-ui/src/hooks/useProjectStream.ts
git -c commit.gpgsign=false commit -m "feat(web-ui): useEvidence + useProjectEvidence hooks (SSE-driven)"
```

---

### Task 11: CaseCompletenessBadge

**Files:**
- Create: `packages/web-ui/src/components/evidence/CaseCompletenessBadge.tsx`
- Create: `packages/web-ui/tests/components/CaseCompletenessBadge.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CaseCompletenessBadge } from "../../src/components/evidence/CaseCompletenessBadge";

describe("CaseCompletenessBadge", () => {
  it("complete: green ✅", () => {
    render(<CaseCompletenessBadge completeness={{
      complete: true, missing: [],
      has_screenshot: true, has_notes: true, has_generated: true,
    }} />);
    expect(screen.getByTestId("evidence-badge").className).toMatch(/green/);
    expect(screen.getByText(/完整/)).toBeInTheDocument();
  });

  it("partial: yellow with missing labels", () => {
    render(<CaseCompletenessBadge completeness={{
      complete: false, missing: ["notes", "generated"],
      has_screenshot: true, has_notes: false, has_generated: false,
    }} />);
    expect(screen.getByTestId("evidence-badge").className).toMatch(/yellow/);
    expect(screen.getByText(/缺.*笔记.*产出/)).toBeInTheDocument();
  });

  it("empty: gray 待上传", () => {
    render(<CaseCompletenessBadge completeness={{
      complete: false, missing: ["screenshot", "notes", "generated"],
      has_screenshot: false, has_notes: false, has_generated: false,
    }} />);
    expect(screen.getByTestId("evidence-badge").className).toMatch(/gray/);
    expect(screen.getByText(/待上传/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `CaseCompletenessBadge.tsx`**

```tsx
import type { CompletenessResult } from "../../api/evidence-client";

const LABEL: Record<string, string> = {
  screenshot: "截图",
  notes: "笔记",
  generated: "产出",
};

export function CaseCompletenessBadge({ completeness }: { completeness: CompletenessResult }) {
  const allEmpty = !completeness.has_screenshot && !completeness.has_notes && !completeness.has_generated;

  let text: string;
  let cls: string;

  if (completeness.complete) {
    text = "✅ 完整";
    cls = "bg-green-50 text-green-700 border-green-300";
  } else if (allEmpty) {
    text = "待上传";
    cls = "bg-gray-50 text-gray-400 border-gray-200";
  } else {
    text = `⚠️ 缺 ${completeness.missing.map((m) => LABEL[m]).join("、")}`;
    cls = "bg-yellow-50 text-yellow-700 border-yellow-300";
  }

  return (
    <span
      data-testid="evidence-badge"
      className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${cls}`}
    >
      {text}
    </span>
  );
}
```

- [ ] **Step 4: Run tests, expect PASS (3/3)**

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/evidence/CaseCompletenessBadge.tsx \
        packages/web-ui/tests/components/CaseCompletenessBadge.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): CaseCompletenessBadge"
```

---

### Task 12: 3 Uploaders (Screenshot / Recording / Media) — single shared component

**Files:**
- Create: `packages/web-ui/src/components/evidence/FileUploader.tsx` (shared base)
- Create: `packages/web-ui/src/components/evidence/ScreenshotUploader.tsx` (thin wrapper)
- Create: `packages/web-ui/src/components/evidence/RecordingUploader.tsx` (thin wrapper)
- Create: `packages/web-ui/src/components/evidence/MediaUploader.tsx` (thin wrapper)
- Create: `packages/web-ui/tests/components/FileUploader.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FileUploader } from "../../src/components/evidence/FileUploader";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

function wrap(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("FileUploader", () => {
  it("renders dropzone label + accept hint", () => {
    wrap(<FileUploader
      label="测试上传"
      accept="image/*"
      hint="只接受图片"
      files={[]}
      onUpload={async () => {}}
      onDelete={async () => {}}
    />);
    expect(screen.getByText("测试上传")).toBeInTheDocument();
    expect(screen.getByText("只接受图片")).toBeInTheDocument();
  });

  it("renders existing files list", () => {
    wrap(<FileUploader
      label="x"
      accept="image/*"
      hint=""
      files={[
        { filename: "a.png", relPath: "a", size: 1024, uploaded_at: "" },
        { filename: "b.png", relPath: "b", size: 2048, uploaded_at: "" },
      ]}
      onUpload={async () => {}}
      onDelete={async () => {}}
    />);
    expect(screen.getByText("a.png")).toBeInTheDocument();
    expect(screen.getByText("b.png")).toBeInTheDocument();
  });

  it("calls onDelete with filename", async () => {
    const onDelete = vi.fn(async () => {});
    wrap(<FileUploader
      label="x"
      accept="image/*"
      hint=""
      files={[{ filename: "a.png", relPath: "a", size: 100, uploaded_at: "" }]}
      onUpload={async () => {}}
      onDelete={onDelete}
    />);
    // skip the confirm dialog by mocking it
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByLabelText("delete a.png"));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("a.png"));
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `packages/web-ui/src/components/evidence/FileUploader.tsx`**

```tsx
import { useRef, useState } from "react";
import type { FileInfo } from "../../api/evidence-client";
import { useToast } from "../ui/ToastProvider";

interface Props {
  label: string;
  accept: string;
  hint: string;
  files: FileInfo[];
  onUpload: (file: File) => Promise<void>;
  onDelete: (filename: string) => Promise<void>;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function FileUploader({ label, accept, hint, files, onUpload, onDelete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const toast = useToast();

  async function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    for (const f of Array.from(fileList)) {
      try {
        await onUpload(f);
        toast.success(`已上传 ${f.name}`);
      } catch (e) {
        toast.error(`上传 ${f.name} 失败：${String(e)}`);
      }
    }
  }

  async function handleDelete(filename: string) {
    if (!window.confirm(`删除 ${filename}?`)) return;
    try {
      await onDelete(filename);
      toast.success(`已删除 ${filename}`);
    } catch (e) {
      toast.error(`删除 ${filename} 失败：${String(e)}`);
    }
  }

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold">{label} ({files.length})</h4>
      <div
        className={`border-2 border-dashed p-4 rounded text-xs text-gray-500 cursor-pointer ${dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300"}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        拖拽文件到这里或点击选择 · {hint}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {files.length > 0 && (
        <ul className="text-xs space-y-1">
          {files.map((f) => (
            <li key={f.filename} className="flex items-center justify-between border px-2 py-1 rounded">
              <span className="truncate">{f.filename}</span>
              <span className="text-gray-500 ml-2">{fmtSize(f.size)}</span>
              <button
                onClick={() => handleDelete(f.filename)}
                aria-label={`delete ${f.filename}`}
                className="ml-2 text-red-500 text-xs"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Implement 3 thin wrappers**

`packages/web-ui/src/components/evidence/ScreenshotUploader.tsx`:
```tsx
import { FileUploader } from "./FileUploader";
import type { FileInfo } from "../../api/evidence-client";

export function ScreenshotUploader(props: {
  files: FileInfo[];
  onUpload: (file: File) => Promise<void>;
  onDelete: (filename: string) => Promise<void>;
}) {
  return (
    <FileUploader
      label="📷 过程截图"
      accept="image/png,image/jpeg,image/webp"
      hint="png/jpg/webp，≤10MB"
      {...props}
    />
  );
}
```

`packages/web-ui/src/components/evidence/RecordingUploader.tsx`:
```tsx
import { FileUploader } from "./FileUploader";
import type { FileInfo } from "../../api/evidence-client";

export function RecordingUploader(props: {
  files: FileInfo[];
  onUpload: (file: File) => Promise<void>;
  onDelete: (filename: string) => Promise<void>;
}) {
  return (
    <FileUploader
      label="🎬 录屏"
      accept="video/mp4,video/quicktime,video/webm"
      hint="mp4/mov/webm，≤100MB"
      {...props}
    />
  );
}
```

`packages/web-ui/src/components/evidence/MediaUploader.tsx`:
```tsx
import { FileUploader } from "./FileUploader";
import type { FileInfo } from "../../api/evidence-client";

export function MediaUploader(props: {
  files: FileInfo[];
  onUpload: (file: File) => Promise<void>;
  onDelete: (filename: string) => Promise<void>;
}) {
  return (
    <FileUploader
      label="🎨 产品产出"
      accept="*/*"
      hint="图/视频/音频/文本，≤200MB"
      {...props}
    />
  );
}
```

- [ ] **Step 5: Run tests, expect PASS**

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/evidence/FileUploader.tsx \
        packages/web-ui/src/components/evidence/ScreenshotUploader.tsx \
        packages/web-ui/src/components/evidence/RecordingUploader.tsx \
        packages/web-ui/src/components/evidence/MediaUploader.tsx \
        packages/web-ui/tests/components/FileUploader.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): FileUploader + 3 typed wrappers"
```

---

### Task 13: NotesEditor

**Files:**
- Create: `packages/web-ui/src/components/evidence/NotesEditor.tsx`
- Create: `packages/web-ui/tests/components/NotesEditor.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotesEditor } from "../../src/components/evidence/NotesEditor";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

function wrap(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("NotesEditor", () => {
  it("renders empty form when notes is null", () => {
    wrap(<NotesEditor
      caseId="case-01"
      notes={null}
      screenshotFiles={[]}
      generatedFiles={[]}
      onSave={async () => {}}
    />);
    expect(screen.getByText(/duration_min/)).toBeInTheDocument();
    expect(screen.getByText(/Observations/)).toBeInTheDocument();
  });

  it("calls onSave with frontmatter + body", async () => {
    const onSave = vi.fn(async () => {});
    wrap(<NotesEditor
      caseId="case-01"
      notes={{
        frontmatter: { type: "evidence_notes", case_id: "case-01", duration_min: 30 },
        body: "existing body",
      }}
      screenshotFiles={[]}
      generatedFiles={[]}
      onSave={onSave}
    />);
    fireEvent.click(screen.getByRole("button", { name: /保存笔记/ }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        frontmatter: expect.objectContaining({
          type: "evidence_notes",
          case_id: "case-01",
          duration_min: 30,
        }),
        body: "existing body",
      }));
    });
  });

  it("adds and removes observation", async () => {
    const onSave = vi.fn(async () => {});
    wrap(<NotesEditor
      caseId="case-01"
      notes={null}
      screenshotFiles={[]}
      generatedFiles={[]}
      onSave={onSave}
    />);
    fireEvent.click(screen.getByRole("button", { name: /\+ 添加 observation/ }));
    const pointInputs = screen.getAllByPlaceholderText(/observation/);
    fireEvent.change(pointInputs[0]!, { target: { value: "new point" } });
    fireEvent.click(screen.getByRole("button", { name: /保存笔记/ }));
    await waitFor(() => {
      const arg = onSave.mock.calls[0]![0];
      expect(arg.frontmatter.observations).toHaveLength(1);
      expect(arg.frontmatter.observations[0].point).toBe("new point");
    });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `NotesEditor.tsx`**

```tsx
import { useState } from "react";
import type { FileInfo } from "../../api/evidence-client";
import { ActionButton } from "../ui/ActionButton";

interface Observation {
  point: string;
  severity: "major" | "minor" | "positive";
  screenshot_ref?: string;
  generated_ref?: string;
}

interface Quantitative {
  rework_count?: number;
  total_steps?: number;
  completed_steps?: number;
  avg_step_time_min?: number;
  total_tokens?: number;
}

interface Frontmatter {
  type: "evidence_notes";
  case_id: string;
  ran_at?: string;
  duration_min?: number;
  quantitative?: Quantitative;
  observations?: Observation[];
}

interface Props {
  caseId: string;
  notes: { frontmatter: Record<string, any>; body: string } | null;
  screenshotFiles: FileInfo[];
  generatedFiles: FileInfo[];
  onSave: (data: { frontmatter: Frontmatter; body: string }) => Promise<void>;
}

function initFrontmatter(caseId: string, fm: Record<string, any> | undefined): Frontmatter {
  return {
    type: "evidence_notes",
    case_id: caseId,
    ran_at: fm?.ran_at,
    duration_min: fm?.duration_min,
    quantitative: fm?.quantitative ?? {},
    observations: fm?.observations ?? [],
  };
}

export function NotesEditor({ caseId, notes, screenshotFiles, generatedFiles, onSave }: Props) {
  const [fm, setFm] = useState<Frontmatter>(() => initFrontmatter(caseId, notes?.frontmatter));
  const [body, setBody] = useState(notes?.body ?? "");

  function setQ(k: keyof Quantitative, v: string) {
    const num = v === "" ? undefined : Number(v);
    setFm({
      ...fm,
      quantitative: { ...(fm.quantitative ?? {}), [k]: num },
    });
  }

  function addObs() {
    setFm({
      ...fm,
      observations: [...(fm.observations ?? []), { point: "", severity: "minor" }],
    });
  }

  function updateObs(i: number, patch: Partial<Observation>) {
    const next = [...(fm.observations ?? [])];
    next[i] = { ...next[i]!, ...patch };
    setFm({ ...fm, observations: next });
  }

  function removeObs(i: number) {
    const next = [...(fm.observations ?? [])];
    next.splice(i, 1);
    setFm({ ...fm, observations: next });
  }

  async function save() {
    // strip empty quantitative entries
    const q: Quantitative = {};
    for (const [k, v] of Object.entries(fm.quantitative ?? {})) {
      if (typeof v === "number" && !isNaN(v)) q[k as keyof Quantitative] = v;
    }
    const cleanFm: Frontmatter = {
      type: "evidence_notes",
      case_id: caseId,
      ...(fm.ran_at ? { ran_at: fm.ran_at } : {}),
      ...(typeof fm.duration_min === "number" ? { duration_min: fm.duration_min } : {}),
      ...(Object.keys(q).length > 0 ? { quantitative: q } : {}),
      ...(fm.observations && fm.observations.length > 0
        ? { observations: fm.observations.filter((o) => o.point.trim()) }
        : {}),
    };
    await onSave({ frontmatter: cleanFm, body });
  }

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold">📝 观察笔记</h4>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label>
          ran_at:
          <input
            type="datetime-local"
            className="w-full border p-1"
            value={fm.ran_at ?? ""}
            onChange={(e) => setFm({ ...fm, ran_at: e.target.value })}
          />
        </label>
        <label>
          duration_min:
          <input
            type="number"
            className="w-full border p-1"
            value={fm.duration_min ?? ""}
            onChange={(e) => setFm({ ...fm, duration_min: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </label>
        <label>
          rework_count:
          <input type="number" className="w-full border p-1"
            value={fm.quantitative?.rework_count ?? ""}
            onChange={(e) => setQ("rework_count", e.target.value)} />
        </label>
        <label>
          total_steps:
          <input type="number" className="w-full border p-1"
            value={fm.quantitative?.total_steps ?? ""}
            onChange={(e) => setQ("total_steps", e.target.value)} />
        </label>
        <label>
          completed_steps:
          <input type="number" className="w-full border p-1"
            value={fm.quantitative?.completed_steps ?? ""}
            onChange={(e) => setQ("completed_steps", e.target.value)} />
        </label>
        <label>
          avg_step_time_min:
          <input type="number" className="w-full border p-1"
            value={fm.quantitative?.avg_step_time_min ?? ""}
            onChange={(e) => setQ("avg_step_time_min", e.target.value)} />
        </label>
      </div>

      <div>
        <h5 className="text-xs font-semibold">Observations</h5>
        <ul className="space-y-2">
          {(fm.observations ?? []).map((obs, i) => (
            <li key={i} className="border p-2 rounded space-y-1">
              <input
                placeholder="observation 内容"
                className="w-full border p-1 text-xs"
                value={obs.point}
                onChange={(e) => updateObs(i, { point: e.target.value })}
              />
              <div className="flex gap-1 text-xs">
                <select
                  className="border p-1"
                  value={obs.severity}
                  onChange={(e) => updateObs(i, { severity: e.target.value as Observation["severity"] })}
                >
                  <option value="major">major</option>
                  <option value="minor">minor</option>
                  <option value="positive">positive</option>
                </select>
                <select
                  className="border p-1 flex-1"
                  value={obs.screenshot_ref ?? ""}
                  onChange={(e) => updateObs(i, { screenshot_ref: e.target.value || undefined })}
                >
                  <option value="">关联截图(无)</option>
                  {screenshotFiles.map((f) => (
                    <option key={f.filename} value={`screenshots/${f.filename}`}>{f.filename}</option>
                  ))}
                </select>
                <select
                  className="border p-1 flex-1"
                  value={obs.generated_ref ?? ""}
                  onChange={(e) => updateObs(i, { generated_ref: e.target.value || undefined })}
                >
                  <option value="">关联产出(无)</option>
                  {generatedFiles.map((f) => (
                    <option key={f.filename} value={`generated/${f.filename}`}>{f.filename}</option>
                  ))}
                </select>
                <button onClick={() => removeObs(i)} className="text-red-500" aria-label={`remove obs ${i}`}>
                  删
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button onClick={addObs} className="text-xs text-blue-600 mt-1">+ 添加 observation</button>
      </div>

      <div>
        <h5 className="text-xs font-semibold">自由笔记</h5>
        <textarea
          className="w-full border p-2 text-xs font-mono"
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      <ActionButton
        onClick={save}
        successMsg="笔记已保存"
        errorMsg={(e) => `保存失败：${String(e)}`}
      >
        保存笔记
      </ActionButton>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/evidence/NotesEditor.tsx \
        packages/web-ui/tests/components/NotesEditor.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): NotesEditor (frontmatter form + observations + free notes)"
```

---

### Task 14: EvidenceIntakeForm (composes uploaders + notes)

**Files:**
- Create: `packages/web-ui/src/components/evidence/EvidenceIntakeForm.tsx`
- Create: `packages/web-ui/tests/components/EvidenceIntakeForm.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { EvidenceIntakeForm } from "../../src/components/evidence/EvidenceIntakeForm";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

vi.mock("../../src/api/evidence-client", () => ({
  getCaseEvidence: vi.fn(async (_p, _c) => ({
    case_id: "case-01",
    name: "Alpha",
    screenshots: [],
    recordings: [],
    generated: [],
    notes: null,
    completeness: { complete: false, missing: ["screenshot", "notes", "generated"], has_screenshot: false, has_notes: false, has_generated: false },
  })),
  uploadEvidenceFile: vi.fn(async () => ({})),
  deleteEvidenceFile: vi.fn(async () => {}),
  putNotes: vi.fn(async () => {}),
}));

vi.mock("../../src/hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [], activeAgents: [] }),
}));

function wrap(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("EvidenceIntakeForm", () => {
  it("renders 3 uploaders + notes editor for selected case", async () => {
    wrap(<EvidenceIntakeForm projectId="p1" caseId="case-01" />);
    await waitFor(() => screen.getByText(/Alpha/));
    expect(screen.getByText(/过程截图/)).toBeInTheDocument();
    expect(screen.getByText(/录屏/)).toBeInTheDocument();
    expect(screen.getByText(/产品产出/)).toBeInTheDocument();
    expect(screen.getByText(/观察笔记/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `EvidenceIntakeForm.tsx`**

```tsx
import { useEvidence } from "../../hooks/useEvidence";
import { uploadEvidenceFile, deleteEvidenceFile, putNotes } from "../../api/evidence-client";
import { ScreenshotUploader } from "./ScreenshotUploader";
import { RecordingUploader } from "./RecordingUploader";
import { MediaUploader } from "./MediaUploader";
import { NotesEditor } from "./NotesEditor";
import { CaseCompletenessBadge } from "./CaseCompletenessBadge";

export function EvidenceIntakeForm({ projectId, caseId }: { projectId: string; caseId: string }) {
  const { detail, loading, reload } = useEvidence(projectId, caseId);

  if (loading || !detail) return <div className="p-4 text-xs text-gray-500">加载 Case 详情…</div>;

  return (
    <div className="space-y-4 p-4">
      <header className="flex items-center justify-between border-b pb-2">
        <h3 className="font-semibold">{detail.case_id} — {detail.name}</h3>
        <CaseCompletenessBadge completeness={detail.completeness} />
      </header>

      <ScreenshotUploader
        files={detail.screenshots}
        onUpload={async (f) => { await uploadEvidenceFile(projectId, caseId, "screenshot", f); reload(); }}
        onDelete={async (n) => { await deleteEvidenceFile(projectId, caseId, "screenshot", n); reload(); }}
      />

      <RecordingUploader
        files={detail.recordings}
        onUpload={async (f) => { await uploadEvidenceFile(projectId, caseId, "recording", f); reload(); }}
        onDelete={async (n) => { await deleteEvidenceFile(projectId, caseId, "recording", n); reload(); }}
      />

      <MediaUploader
        files={detail.generated}
        onUpload={async (f) => { await uploadEvidenceFile(projectId, caseId, "generated", f); reload(); }}
        onDelete={async (n) => { await deleteEvidenceFile(projectId, caseId, "generated", n); reload(); }}
      />

      <NotesEditor
        caseId={caseId}
        notes={detail.notes}
        screenshotFiles={detail.screenshots}
        generatedFiles={detail.generated}
        onSave={async (data) => { await putNotes(projectId, caseId, data); reload(); }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/evidence/EvidenceIntakeForm.tsx \
        packages/web-ui/tests/components/EvidenceIntakeForm.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): EvidenceIntakeForm composes uploaders + notes"
```

---

### Task 15: EvidenceSection (left-pane cards + submit)

**Files:**
- Create: `packages/web-ui/src/components/evidence/EvidenceSection.tsx`
- Create: `packages/web-ui/tests/components/EvidenceSection.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EvidenceSection } from "../../src/components/evidence/EvidenceSection";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

vi.mock("../../src/api/evidence-client", () => ({
  getProjectEvidence: vi.fn(async () => ({
    cases: {
      "case-01": { has_screenshot: true, has_notes: true, has_generated: true, complete: true,
        counts: { screenshots: 2, recordings: 1, generated: 3 }, last_updated_at: "" },
      "case-02": { has_screenshot: true, has_notes: false, has_generated: false, complete: false,
        counts: { screenshots: 1, recordings: 0, generated: 0 }, last_updated_at: "" },
    },
    all_complete: false,
    submitted_at: null,
    index_path: "evidence/index.md",
  })),
  submitEvidence: vi.fn(async () => {}),
}));

vi.mock("../../src/hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [], activeAgents: [] }),
}));

function wrap(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("EvidenceSection", () => {
  it("renders per-case rows with badges", async () => {
    const onSelect = vi.fn();
    wrap(<EvidenceSection projectId="p1" selectedCaseId={null} onSelectCase={onSelect} />);
    await waitFor(() => screen.getByText(/case-01/));
    expect(screen.getByText(/case-02/)).toBeInTheDocument();
    expect(screen.getByText(/1\/2 完整/)).toBeInTheDocument();
  });

  it("submit button disabled when not all complete", async () => {
    wrap(<EvidenceSection projectId="p1" selectedCaseId={null} onSelectCase={() => {}} />);
    await waitFor(() => screen.getByText(/case-01/));
    expect(screen.getByRole("button", { name: /提交 Evidence/ })).toBeDisabled();
  });

  it("clicking case row triggers onSelectCase", async () => {
    const onSelect = vi.fn();
    wrap(<EvidenceSection projectId="p1" selectedCaseId={null} onSelectCase={onSelect} />);
    await waitFor(() => screen.getByText(/case-01/));
    fireEvent.click(screen.getByTestId("case-row-case-01"));
    expect(onSelect).toHaveBeenCalledWith("case-01");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `EvidenceSection.tsx`**

```tsx
import { useProjectEvidence } from "../../hooks/useProjectEvidence";
import { submitEvidence } from "../../api/evidence-client";
import { CaseCompletenessBadge } from "./CaseCompletenessBadge";
import { ActionButton } from "../ui/ActionButton";

export function EvidenceSection({
  projectId,
  selectedCaseId,
  onSelectCase,
}: {
  projectId: string;
  selectedCaseId: string | null;
  onSelectCase: (caseId: string) => void;
}) {
  const { evidence, reload } = useProjectEvidence(projectId);

  if (!evidence) return <div className="text-xs text-gray-500">加载…</div>;

  const entries = Object.entries(evidence.cases);
  const completeCount = entries.filter(([, v]) => v.complete).length;
  const total = entries.length;

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {entries.map(([caseId, c]) => {
          const sel = caseId === selectedCaseId;
          return (
            <li
              key={caseId}
              data-testid={`case-row-${caseId}`}
              onClick={() => onSelectCase(caseId)}
              className={`cursor-pointer border p-2 rounded ${sel ? "border-blue-500 bg-blue-50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono">{caseId}</span>
                <CaseCompletenessBadge completeness={{
                  complete: c.complete,
                  missing: [
                    !c.has_screenshot ? "screenshot" : null,
                    !c.has_notes ? "notes" : null,
                    !c.has_generated ? "generated" : null,
                  ].filter(Boolean) as any,
                  has_screenshot: c.has_screenshot,
                  has_notes: c.has_notes,
                  has_generated: c.has_generated,
                }} />
              </div>
              <div className="text-xs text-gray-500">
                {c.counts.screenshots} 截图 · {c.counts.recordings} 录屏 · {c.counts.generated} 产出
              </div>
            </li>
          );
        })}
      </ul>
      <div className="border-t pt-2 text-xs flex items-center justify-between">
        <span>进度：{completeCount}/{total} 完整</span>
        <ActionButton
          onClick={async () => { await submitEvidence(projectId); reload(); }}
          disabled={!evidence.all_complete || evidence.submitted_at !== null}
          successMsg="已提交 Evidence"
          errorMsg={(e) => `提交失败：${String(e)}`}
        >
          {evidence.submitted_at ? "已提交" : "提交 Evidence"}
        </ActionButton>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, expect PASS**

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/components/evidence/EvidenceSection.tsx \
        packages/web-ui/tests/components/EvidenceSection.test.tsx
git -c commit.gpgsign=false commit -m "feat(web-ui): EvidenceSection (left-pane case cards + submit)"
```

---

### Task 16: ProjectWorkbench integration + e2e test

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx`
- Modify: `packages/web-ui/src/components/status/SectionStatusBadge.tsx`
- Create: `packages/web-server/tests/integration-sp04-e2e.test.ts`

- [ ] **Step 1: Modify SectionStatusBadge to know about evidence**

Read `packages/web-ui/src/components/status/SectionStatusBadge.tsx`. Add `"evidence"` to `SectionKey`, then:

In `AGENT_PREFIXES`:
```ts
evidence: () => false,  // evidence has no agent; badge is project-state-driven only
```

In `SECTION_ORDER`, append:
```ts
{ key: "evidence", states: ["evidence_collecting", "evidence_ready"] },
```

(Keep existing brief / mission / overview / case entries unchanged.)

- [ ] **Step 2: Modify ProjectWorkbench.tsx**

Read the file. Then:

a) Add imports:
```tsx
import { EvidenceSection } from "../components/evidence/EvidenceSection";
import { EvidenceIntakeForm } from "../components/evidence/EvidenceIntakeForm";
```

b) Add state for selected evidence case:
```tsx
const [selectedEvidenceCase, setSelectedEvidenceCase] = useState<string | null>(null);
```

c) In the SectionAccordion (after the "Case 列表" section), append a 5th section:
```tsx
<Section
  title={<>Evidence <SectionStatusBadge sectionKey="evidence" projectStatus={status} activeAgents={activeAgents} events={events} /></>}
  status={sectionStatusFor("evidence", status)}
>
  {(status === "evidence_collecting" || status === "evidence_ready" || status === "case_plan_approved") ? (
    <EvidenceSection
      projectId={projectId}
      selectedCaseId={selectedEvidenceCase}
      onSelectCase={setSelectedEvidenceCase}
    />
  ) : (
    <div className="text-xs text-gray-400">case_plan_approved 后启用</div>
  )}
</Section>
```

d) Find the existing `SECTION_ORDER` constant in ProjectWorkbench.tsx (it's used by `sectionStatusFor`). Append:
```ts
{ key: "evidence", activeStates: ["evidence_collecting", "evidence_ready"] },
```

e) Inside `rightPanel(status, ...)`, add cases:
```tsx
case "evidence_collecting":
case "evidence_ready":
  return selectedEvidenceCase
    ? <EvidenceIntakeForm projectId={projectId} caseId={selectedEvidenceCase} />
    : <div className="p-4 text-sm text-gray-500">← 左侧选一个 Case 开始上传 evidence</div>;
```

(Update `rightPanel` signature if it doesn't accept `selectedEvidenceCase` — pass it through, or read state directly inside the JSX in render.)

Simplest: don't put evidence into rightPanel switch; render directly in JSX:

```tsx
{(status === "evidence_collecting" || status === "evidence_ready") ? (
  selectedEvidenceCase
    ? <EvidenceIntakeForm projectId={projectId} caseId={selectedEvidenceCase} />
    : <div className="p-4 text-sm text-gray-500">← 左侧选一个 Case 开始上传 evidence</div>
) : rightPanel(status, projectId, refetch, events)}
```

- [ ] **Step 3: Update ProjectWorkbench tests if needed**

Read `packages/web-ui/tests/pages/ProjectWorkbench.test.tsx`. Add 2 cases to `it.each`:

```tsx
["evidence_collecting", /左侧选一个 Case|加载…/],
["evidence_ready", /左侧选一个 Case|加载…/],
```

(The text matches the empty selection state since selectedEvidenceCase is null; add to mocks if needed:
```tsx
vi.mock("../../src/api/evidence-client", () => ({
  getProjectEvidence: vi.fn(async () => ({ cases: {}, all_complete: true, submitted_at: null, index_path: "" })),
  getCaseEvidence: vi.fn(),
  uploadEvidenceFile: vi.fn(),
  deleteEvidenceFile: vi.fn(),
  putNotes: vi.fn(),
  submitEvidence: vi.fn(),
}));
```
)

- [ ] **Step 4: Create e2e test `packages/web-server/tests/integration-sp04-e2e.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerEvidenceRoutes } from "../src/routes/evidence.js";
import { ProjectStore } from "../src/services/project-store.js";

function multipartBody(boundary: string, kind: string, filename: string, contentType: string, content: string) {
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="kind"`, ``, kind,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`, ``, content,
    `--${boundary}--`, ``,
  ].join("\r\n");
}

describe("SP-04 e2e", () => {
  it("walks case_plan_approved → upload 3 files + notes → submit → evidence_ready", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sp04-e2e-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const app = Fastify();
    await app.register(multipart);
    registerProjectsRoutes(app, { store });
    registerEvidenceRoutes(app, { store, projectsDir });
    await app.ready();

    const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "E2E" } })).json();
    await store.update(p.id, { status: "case_plan_approved" });
    const cpDir = join(projectsDir, p.id, "mission/case-plan");
    mkdirSync(cpDir, { recursive: true });
    writeFileSync(join(cpDir, "selected-cases.md"),
      `---\ntype: case_plan\nselected_indices: [1]\n---\n\n# Case 1 — Solo\nbody\n`, "utf-8");

    // 1. GET evidence triggers init + state transition
    const r1 = await app.inject({ method: "GET", url: `/api/projects/${p.id}/evidence` });
    expect(r1.statusCode).toBe(200);
    expect((await store.get(p.id))?.status).toBe("evidence_collecting");

    // 2. Upload 1 screenshot
    const b1 = "----b1";
    const r2 = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/evidence/case-01/files`,
      payload: multipartBody(b1, "screenshot", "shot.png", "image/png", "img"),
      headers: { "content-type": `multipart/form-data; boundary=${b1}` },
    });
    expect(r2.statusCode).toBe(201);

    // 3. Upload 1 generated
    const b2 = "----b2";
    const r3 = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/evidence/case-01/files`,
      payload: multipartBody(b2, "generated", "out.md", "text/markdown", "x"),
      headers: { "content-type": `multipart/form-data; boundary=${b2}` },
    });
    expect(r3.statusCode).toBe(201);

    // 4. PUT notes
    const r4 = await app.inject({
      method: "PUT",
      url: `/api/projects/${p.id}/evidence/case-01/notes`,
      payload: {
        frontmatter: {
          type: "evidence_notes",
          case_id: "case-01",
          duration_min: 30,
          observations: [{ point: "good", severity: "positive" }],
        },
        body: "all good",
      },
    });
    expect(r4.statusCode).toBe(200);

    // 5. Submit
    const r5 = await app.inject({ method: "POST", url: `/api/projects/${p.id}/evidence/submit` });
    expect(r5.statusCode).toBe(200);

    const final = await store.get(p.id);
    expect(final?.status).toBe("evidence_ready");
    expect(final?.evidence?.submitted_at).toBeTruthy();
    expect(existsSync(join(projectsDir, p.id, "evidence/index.md"))).toBe(true);
    expect(existsSync(join(projectsDir, p.id, "evidence/case-01/notes.md"))).toBe(true);
  });
});
```

- [ ] **Step 5: Run all tests**

```bash
cd /Users/zeoooo/crossing-writer && pnpm -r test
```

Expected: all green (web-server new e2e + previous; web-ui new sections + previous).

- [ ] **Step 6: Manual smoke checklist (human)**

```
- [ ] pnpm dev → 浏览器打开
- [ ] 选 MetaNovas 项目（status: case_plan_approved 或更新到此状态）
- [ ] 左栏看到 Evidence section (新增第 5 个，badge 显示 0/N 完整)
- [ ] 展开 → 看到 per-case 卡片
- [ ] 点 Case 01 → 右栏出 EvidenceIntakeForm
- [ ] 拖一张截图到截图区 → toast "已上传 X.png"，列表更新
- [ ] 拖一个视频到产品产出区 → toast 成功
- [ ] 点删按钮 → 确认弹窗 → toast "已删除"
- [ ] 写点笔记 + 加 1 个 observation → 保存笔记 → toast "笔记已保存"
- [ ] 左栏卡片变 ⚠️/✅ 反映完整度
- [ ] 全 case 完整后"提交 Evidence"按钮 enabled → 点 → toast → 状态变 evidence_ready
- [ ] cat ~/CrossingVault/07_projects/<id>/evidence/index.md 看完整索引
```

- [ ] **Step 7: Commit**

```bash
cd /Users/zeoooo/crossing-writer
git add packages/web-ui/src/pages/ProjectWorkbench.tsx \
        packages/web-ui/src/components/status/SectionStatusBadge.tsx \
        packages/web-ui/tests/pages/ProjectWorkbench.test.tsx \
        packages/web-server/tests/integration-sp04-e2e.test.ts
git -c commit.gpgsign=false commit -m "feat(web-ui,web-server): integrate Evidence section + e2e test"
```

---

## Self-Review

**Spec coverage:**
- §3 数据模型（notes / index / Project.evidence）→ T2/T3 ✓
- §4 Completeness 规则 → T2 ✓
- §5 后端 API（GET × 2 + POST file + DELETE file + GET/PUT notes + submit）→ T4-T8 ✓
- §6 状态机扩展 → T1 + T4 lazy 转 ✓
- §7 前端 UI（左栏 Section / 右栏表单 / 3 uploader / NotesEditor / Badge）→ T11-T15 ✓
- §8 错误处理（toast + 红字 echo + 404 silent delete）→ T6 (silent) + T9 (client throws with msg) + ActionButton echo ✓
- §9 测试策略（30+ tests across all layers）→ 16 tasks 各带 tests ✓
- §3.6 SSE evidence.updated/submitted → T10 ✓ (added to EVENT_TYPES)

**Placeholder scan:** No "TBD" / "TODO" / "implement later". All code complete.

**Type consistency:**
- `EvidenceKind = "screenshot" | "recording" | "generated"` 一致（T3 backend / T9 frontend client）
- `CompletenessResult` 一致 (T2 backend / T9 frontend re-defined identically)
- `FileInfo` shape 一致
- `CaseDetail` shape 一致
- `Frontmatter` 类型在 T13 NotesEditor 内部定义，外界传字符串 frontmatter 给 onSave，签名匹配

**Note to executor:** Task 16 modifies `ProjectWorkbench.tsx` which is a heavily-evolved file. Read carefully before editing; preserve all SP-03 / SP-03.5 UI sections (Brief / Mission / Overview / Case + AgentTimeline + SettingsDrawer + AgentStatusBar + ⚙ button).
