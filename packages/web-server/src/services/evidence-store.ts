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
