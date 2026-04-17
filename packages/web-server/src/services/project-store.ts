import { mkdir, readFile, writeFile, readdir, rename, rm, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import type { ProjectStatus, ProjectStage } from "../state/state-machine.js";

export interface Project {
  id: string;
  name: string;
  slug: string;
  status: ProjectStatus;
  stage: ProjectStage;
  article_type: '实测' | '访谈' | '评论' | null;
  expected_word_count: number | null;
  deadline: string | null;
  priority: "low" | "normal" | "high";
  tags: string[];
  client: { name: string | null; brand: string | null; product: string | null };
  brief: null | {
    source_type: string;
    raw_path: string;
    md_path: string;
    summary_path: string | null;
    uploaded_at: string;
  };
  product_info: null | {
    name: string | null;
    official_url: string | null;
    trial_url: string | null;
    docs_url: string | null;
    fetched_path: string | null;
    notes: string | null;
  };
  experts_selected: string[];
  mission: {
    candidates_path: string | null;
    selected_index: number | null;
    selected_path: string | null;
    selected_at: string | null;
    selected_by: string | null;
  };
  overview?: {
    images_dir: string;
    overview_path: string;
    generated_at: string;
    human_edited: boolean;
    edited_at?: string;
  };
  case_plan?: {
    experts_selected: string[];
    candidates_path: string;
    selected_path: string | null;
    selected_indices: number[] | null;
    selected_count: number;
    approved_at: string | null;
  };
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
  writer_failed_sections?: string[];
  runs: Array<{
    id: string;
    stage: string;
    started_at: string;
    ended_at: string | null;
    experts: string[];
    status: "running" | "completed" | "failed";
  }>;
  created_at: string;
  updated_at: string;
  schema_version: 1;
}

export class ProjectConflictError extends Error {
  constructor(public readonly id: string, msg: string) {
    super(msg);
    this.name = "ProjectConflictError";
  }
}

export class ConfirmationMismatchError extends Error {
  constructor(public readonly expected: string) {
    super(`confirmation_mismatch: expected ${expected}`);
    this.name = "ConfirmationMismatchError";
  }
}

const ARCHIVE_DIRNAME = "_archive";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "")
    .slice(0, 60) || "project";
}

export class ProjectStore {
  constructor(private root: string) {}

  projectDir(id: string): string {
    return join(this.root, id);
  }

  archiveDir(id: string): string {
    return join(this.root, ARCHIVE_DIRNAME, id);
  }

  async create(input: { name: string }): Promise<Project> {
    const base = slugify(input.name);
    let id = base;
    let n = 1;
    while (await this.exists(id)) {
      n += 1;
      id = `${base}-${n}`;
    }
    const now = new Date().toISOString();
    const p: Project = {
      id,
      name: input.name,
      slug: base,
      status: "created",
      stage: "intake",
      article_type: null,
      expected_word_count: null,
      deadline: null,
      priority: "normal",
      tags: [],
      client: { name: null, brand: null, product: null },
      brief: null,
      product_info: null,
      experts_selected: [],
      mission: {
        candidates_path: null,
        selected_index: null,
        selected_path: null,
        selected_at: null,
        selected_by: null,
      },
      runs: [],
      created_at: now,
      updated_at: now,
      schema_version: 1,
    };
    await mkdir(this.projectDir(id), { recursive: true });
    await writeFile(
      join(this.projectDir(id), "project.json"),
      JSON.stringify(p, null, 2),
      "utf-8",
    );
    return p;
  }

  async exists(id: string): Promise<boolean> {
    try {
      await readFile(join(this.projectDir(id), "project.json"), "utf-8");
      return true;
    } catch { return false; }
  }

  async get(id: string): Promise<Project | null> {
    try {
      const raw = await readFile(join(this.projectDir(id), "project.json"), "utf-8");
      return JSON.parse(raw) as Project;
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }

  async list(): Promise<Project[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      const out: Project[] = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith("_")) continue; // skip _archive and other metadata dirs
        const p = await this.get(e.name);
        if (p) out.push(p);
      }
      return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    } catch (e: any) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }

  async update(id: string, patch: Partial<Project>): Promise<Project> {
    const p = await this.get(id);
    if (!p) throw new Error(`project not found: ${id}`);
    const merged: Project = { ...p, ...patch, updated_at: new Date().toISOString() };
    await writeFile(
      join(this.projectDir(id), "project.json"),
      JSON.stringify(merged, null, 2),
      "utf-8",
    );
    return merged;
  }

  async isArchived(id: string): Promise<boolean> {
    try {
      await access(join(this.archiveDir(id), "project.json"), fsConstants.F_OK);
      return true;
    } catch { return false; }
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path, fsConstants.F_OK);
      return true;
    } catch { return false; }
  }

  async archive(id: string): Promise<void> {
    const src = this.projectDir(id);
    if (!(await this.pathExists(join(src, "project.json")))) {
      throw new Error(`project_not_found: ${id}`);
    }
    const dst = this.archiveDir(id);
    if (await this.pathExists(dst)) {
      throw new ProjectConflictError(id, `already_archived: ${id}`);
    }
    await mkdir(join(this.root, ARCHIVE_DIRNAME), { recursive: true });
    await rename(src, dst);
  }

  async restore(id: string): Promise<void> {
    const src = this.archiveDir(id);
    if (!(await this.pathExists(join(src, "project.json")))) {
      throw new Error(`project_not_found: ${id}`);
    }
    const dst = this.projectDir(id);
    if (await this.pathExists(dst)) {
      throw new ProjectConflictError(id, `name_conflict: ${id} already exists in active`);
    }
    await rename(src, dst);
  }

  async destroy(id: string, opts: { confirmSlug: string }): Promise<{ removedPath: string }> {
    let target: string | null = null;
    let projJson: string | null = null;
    const activeFile = join(this.projectDir(id), "project.json");
    const archivedFile = join(this.archiveDir(id), "project.json");
    if (await this.pathExists(activeFile)) {
      target = this.projectDir(id);
      projJson = activeFile;
    } else if (await this.pathExists(archivedFile)) {
      target = this.archiveDir(id);
      projJson = archivedFile;
    } else {
      throw new Error(`project_not_found: ${id}`);
    }
    const raw = await readFile(projJson, "utf-8");
    const p = JSON.parse(raw) as Project;
    if (p.slug !== opts.confirmSlug) {
      throw new ConfirmationMismatchError(p.slug);
    }
    await rm(target, { recursive: true, force: true });
    return { removedPath: target };
  }

  async listArchived(): Promise<Project[]> {
    const archiveRoot = join(this.root, ARCHIVE_DIRNAME);
    try {
      const entries = await readdir(archiveRoot, { withFileTypes: true });
      const out: Project[] = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        try {
          const raw = await readFile(join(archiveRoot, e.name, "project.json"), "utf-8");
          out.push(JSON.parse(raw) as Project);
        } catch { /* skip */ }
      }
      return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    } catch (e: any) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }
}
