import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface TopicExpertMeta {
  name: string;
  specialty: string;
  active: boolean;
  default_preselect: boolean;
  soft_deleted: boolean;
  updated_at?: string;
  distilled_at?: string;
  version?: number;
}

export interface TopicExpertDetail extends TopicExpertMeta {
  kb_markdown: string;
  word_count: number;
}

interface IndexFile {
  version: number;
  updated_at: string;
  experts: TopicExpertMeta[];
}

export interface TopicExpertStoreOpts {
  commit?: (message: string) => Promise<void>;
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const yamlPart = raw.slice(3, end).replace(/^\n/, "");
  // skip the closing --- line
  let bodyStart = end + 4;
  if (raw[bodyStart] === "\n") bodyStart += 1;
  const body = raw.slice(bodyStart);
  try {
    const data = (parseYaml(yamlPart) as Record<string, unknown>) ?? {};
    return { data, body };
  } catch {
    return { data: {}, body: raw };
  }
}

function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const yamlStr = stringifyYaml(data).trimEnd();
  return `---\n${yamlStr}\n---\n${body}`;
}

export class TopicExpertStore {
  private panelDir: string;
  private indexPath: string;
  private expertsDir: string;
  private trashDir: string;
  private commit: (message: string) => Promise<void>;

  constructor(vaultRoot: string, opts: TopicExpertStoreOpts = {}) {
    this.panelDir = join(vaultRoot, "08_experts/topic-panel");
    this.indexPath = join(this.panelDir, "index.yaml");
    this.expertsDir = join(this.panelDir, "experts");
    this.trashDir = join(this.panelDir, ".trash");
    this.commit = opts.commit ?? (async () => {});
  }

  private ensureDirs() {
    mkdirSync(this.panelDir, { recursive: true });
    mkdirSync(this.expertsDir, { recursive: true });
  }

  private readIndex(): IndexFile {
    this.ensureDirs();
    if (existsSync(this.indexPath)) {
      const raw = readFileSync(this.indexPath, "utf-8");
      const parsed = (parseYaml(raw) as Partial<IndexFile>) ?? {};
      return {
        version: parsed.version ?? 1,
        updated_at: parsed.updated_at ?? new Date().toISOString(),
        experts: (parsed.experts ?? []).map((e) => ({
          name: e.name,
          specialty: e.specialty ?? "",
          active: e.active ?? true,
          default_preselect: e.default_preselect ?? false,
          soft_deleted: e.soft_deleted ?? false,
          updated_at: e.updated_at,
          distilled_at: e.distilled_at,
          version: e.version,
        })),
      };
    }
    // bootstrap from _kb.md files
    const experts: TopicExpertMeta[] = [];
    if (existsSync(this.expertsDir)) {
      for (const f of readdirSync(this.expertsDir)) {
        if (!f.endsWith("_kb.md")) continue;
        const name = f.replace(/_kb\.md$/, "");
        const raw = readFileSync(join(this.expertsDir, f), "utf-8");
        const { data } = parseFrontmatter(raw);
        experts.push({
          name,
          specialty: (data.specialty as string) ?? "",
          active: true,
          default_preselect: false,
          soft_deleted: false,
          updated_at: (data.updated_at as string) ?? undefined,
          distilled_at: (data.distilled_at as string) ?? undefined,
          version: (data.version as number) ?? undefined,
        });
      }
    }
    return {
      version: 1,
      updated_at: new Date().toISOString(),
      experts,
    };
  }

  private async writeIndex(idx: IndexFile, commitMessage: string) {
    this.ensureDirs();
    idx.updated_at = new Date().toISOString();
    writeFileSync(this.indexPath, stringifyYaml(idx), "utf-8");
    await this.commit(commitMessage);
  }

  async list(): Promise<TopicExpertMeta[]> {
    return this.readIndex().experts;
  }

  async get(name: string): Promise<TopicExpertDetail | null> {
    const idx = this.readIndex();
    const meta = idx.experts.find((e) => e.name === name);
    if (!meta) return null;
    if (meta.soft_deleted) return null;
    const kbPath = join(this.expertsDir, `${name}_kb.md`);
    if (!existsSync(kbPath)) return null;
    const raw = readFileSync(kbPath, "utf-8");
    const { data, body } = parseFrontmatter(raw);
    return {
      ...meta,
      specialty: (data.specialty as string) ?? meta.specialty,
      updated_at: (data.updated_at as string) ?? meta.updated_at,
      distilled_at: (data.distilled_at as string) ?? meta.distilled_at,
      version: (data.version as number) ?? meta.version,
      kb_markdown: body,
      word_count: body.length,
    };
  }

  async set(
    name: string,
    patch: Partial<Pick<TopicExpertMeta, "active" | "default_preselect" | "specialty">>,
  ): Promise<TopicExpertMeta> {
    const idx = this.readIndex();
    const entry = idx.experts.find((e) => e.name === name);
    if (!entry) throw new Error(`expert not found: ${name}`);
    if (patch.active !== undefined) entry.active = patch.active;
    if (patch.default_preselect !== undefined) entry.default_preselect = patch.default_preselect;
    if (patch.specialty !== undefined) entry.specialty = patch.specialty;
    entry.updated_at = new Date().toISOString();
    await this.writeIndex(idx, `topic-expert: update ${name}`);
    return entry;
  }

  async writeKb(
    name: string,
    body: string,
    frontmatterPatch?: Record<string, unknown>,
  ): Promise<void> {
    this.ensureDirs();
    const kbPath = join(this.expertsDir, `${name}_kb.md`);
    let data: Record<string, unknown> = { name };
    if (existsSync(kbPath)) {
      const raw = readFileSync(kbPath, "utf-8");
      data = parseFrontmatter(raw).data;
    }
    data = { ...data, ...(frontmatterPatch ?? {}) };
    writeFileSync(kbPath, stringifyFrontmatter(data, body), "utf-8");
    await this.commit(`topic-expert: kb ${name}`);
  }

  async create(name: string, specialty: string): Promise<TopicExpertMeta> {
    const idx = this.readIndex();
    const dup = idx.experts.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (dup) throw new Error(`expert already exists: ${name}`);
    const meta: TopicExpertMeta = {
      name,
      specialty,
      active: false,
      default_preselect: false,
      soft_deleted: false,
      updated_at: new Date().toISOString(),
    };
    idx.experts.push(meta);
    // write stub KB
    this.ensureDirs();
    const kbPath = join(this.expertsDir, `${name}_kb.md`);
    if (!existsSync(kbPath)) {
      writeFileSync(
        kbPath,
        stringifyFrontmatter({ name, specialty }, ""),
        "utf-8",
      );
    }
    await this.writeIndex(idx, `topic-expert: create ${name}`);
    return meta;
  }

  async softDelete(name: string): Promise<void> {
    const idx = this.readIndex();
    const entry = idx.experts.find((e) => e.name === name);
    if (!entry) throw new Error(`expert not found: ${name}`);
    entry.soft_deleted = true;
    entry.updated_at = new Date().toISOString();
    await this.writeIndex(idx, `topic-expert: soft-delete ${name}`);
  }

  async hardDelete(name: string): Promise<void> {
    const idx = this.readIndex();
    const i = idx.experts.findIndex((e) => e.name === name);
    if (i === -1) throw new Error(`expert not found: ${name}`);
    idx.experts.splice(i, 1);
    mkdirSync(this.trashDir, { recursive: true });
    const src = join(this.expertsDir, `${name}_kb.md`);
    if (existsSync(src)) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const dst = join(this.trashDir, `${name}_kb.${ts}.md`);
      renameSync(src, dst);
    }
    await this.writeIndex(idx, `topic-expert: hard-delete ${name}`);
  }

  async backupKb(name: string): Promise<string | null> {
    const kbPath = join(this.expertsDir, `${name}_kb.md`);
    if (!existsSync(kbPath)) return null;
    const raw = readFileSync(kbPath, "utf-8");
    const { body } = parseFrontmatter(raw);
    if (!body.trim()) return null;
    const bakDir = join(this.panelDir, ".bak");
    mkdirSync(bakDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dst = join(bakDir, `${name}_kb.${ts}.md`);
    writeFileSync(dst, raw, "utf-8");
    return dst;
  }
}
