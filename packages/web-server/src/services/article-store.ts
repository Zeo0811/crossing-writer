import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import yaml from "js-yaml";

export type SectionKey =
  | "opening"
  | "closing"
  | "transitions"
  | `practice.case-${string}`;

export interface SectionFrontmatter {
  section: SectionKey;
  last_agent: string;
  last_updated_at: string;
  reference_accounts?: string[];
  cli?: string;
  model?: string;
}

export interface ArticleSectionFile {
  key: SectionKey;
  frontmatter: SectionFrontmatter;
  body: string;
}

function sectionPath(baseDir: string, key: SectionKey): string {
  const sections = join(baseDir, "article", "sections");
  if (key === "opening") return join(sections, "opening.md");
  if (key === "closing") return join(sections, "closing.md");
  if (key === "transitions") return join(sections, "practice", "transitions.md");
  if (key.startsWith("practice.case-")) {
    const caseId = key.slice("practice.".length);
    return join(sections, "practice", `${caseId}.md`);
  }
  throw new Error(`unknown section key: ${key}`);
}

function parseFile(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return { frontmatter: {}, body: raw };
  return { frontmatter: (yaml.load(m[1]!) as Record<string, unknown>) ?? {}, body: m[2]!.replace(/^\n/, "").replace(/\n$/, "") };
}

function serialize(file: ArticleSectionFile): string {
  const fm = yaml.dump(file.frontmatter, { lineWidth: 200 }).trim();
  return `---\n${fm}\n---\n\n${file.body}\n`;
}

function caseOrder(key: SectionKey): number {
  if (key === "opening") return 0;
  if (key === "closing") return 9999;
  if (key === "transitions") return 9998;
  const m = /^practice\.case-(\d+)/.exec(key);
  if (m) return parseInt(m[1]!, 10);
  return 10000;
}

export interface SplitResult {
  ok: boolean;
  sections?: Record<string, string>;
  fallbackUsed?: "markers" | "h-headings";
  reason?: string;
}

export class ArticleStore {
  constructor(private projectDir: string) {}

  async init(): Promise<void> {
    await mkdir(join(this.projectDir, "article", "sections", "practice"), { recursive: true });
  }

  async writeSection(key: SectionKey, file: ArticleSectionFile): Promise<void> {
    const p = sectionPath(this.projectDir, key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, serialize(file), "utf-8");
    await this.rebuildFinal();
  }

  async readSection(key: SectionKey): Promise<ArticleSectionFile | null> {
    const p = sectionPath(this.projectDir, key);
    if (!existsSync(p)) return null;
    const raw = await readFile(p, "utf-8");
    const { frontmatter, body } = parseFile(raw);
    return { key, frontmatter: frontmatter as unknown as SectionFrontmatter, body };
  }

  async listSections(): Promise<ArticleSectionFile[]> {
    const out: ArticleSectionFile[] = [];
    const s = join(this.projectDir, "article", "sections");
    if (existsSync(join(s, "opening.md"))) {
      const r = await this.readSection("opening");
      if (r) out.push(r);
    }
    const pDir = join(s, "practice");
    if (existsSync(pDir)) {
      for (const f of await readdir(pDir)) {
        if (!f.endsWith(".md")) continue;
        if (f === "transitions.md") continue; // excluded from listSections
        const caseId = f.replace(/\.md$/, "");
        const r = await this.readSection(`practice.${caseId}` as SectionKey);
        if (r) out.push(r);
      }
    }
    if (existsSync(join(s, "closing.md"))) {
      const r = await this.readSection("closing");
      if (r) out.push(r);
    }
    const practiceOnly = out.filter((x) => x.key.startsWith("practice.case-"));
    practiceOnly.sort((a, b) => caseOrder(a.key) - caseOrder(b.key));
    const open = out.find((x) => x.key === "opening");
    const close = out.find((x) => x.key === "closing");
    const ordered: ArticleSectionFile[] = [];
    if (open) ordered.push(open);
    ordered.push(...practiceOnly);
    if (close) ordered.push(close);
    return ordered;
  }

  private async loadTransitions(): Promise<Record<string, string>> {
    const r = await this.readSection("transitions");
    if (!r) return {};
    const transitions: Record<string, string> = {};
    const re = /##\s+transition\.([a-z0-9-]+)\s*\n([\s\S]*?)(?=(\n##\s+transition\.)|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(r.body))) {
      transitions[m[1]!] = m[2]!.trim();
    }
    return transitions;
  }

  async mergeFinal(): Promise<string> {
    const sections = await this.listSections();
    const open = sections.find((s) => s.key === "opening");
    const close = sections.find((s) => s.key === "closing");
    const practice = sections.filter((s) => s.key.startsWith("practice.case-"));
    const transitions = await this.loadTransitions();

    const refAccounts = new Set<string>();
    for (const s of sections) for (const a of s.frontmatter.reference_accounts ?? []) refAccounts.add(a);

    const topFm = {
      type: "article_draft",
      project_id: this.projectDir.split("/").pop() ?? "",
      produced_at: new Date().toISOString(),
      reference_accounts_summary: [...refAccounts],
    };

    const parts: string[] = [];
    parts.push(`---\n${yaml.dump(topFm, { lineWidth: 200 }).trim()}\n---\n`);
    if (open) parts.push(`<!-- section:opening -->\n${open.body}`);
    for (let i = 0; i < practice.length; i++) {
      const p = practice[i]!;
      parts.push(`<!-- section:${p.key} -->\n${p.body}`);
      if (i < practice.length - 1) {
        const next = practice[i + 1]!;
        const trKey = `${p.key.slice("practice.".length)}-to-${next.key.slice("practice.".length)}`;
        if (transitions[trKey]) {
          parts.push(`<!-- section:transition.${trKey} -->\n${transitions[trKey]}`);
        }
      }
    }
    if (close) parts.push(`<!-- section:closing -->\n${close.body}`);
    return parts.join("\n\n");
  }

  async rebuildFinal(): Promise<string> {
    const merged = await this.mergeFinal();
    const p = join(this.projectDir, "article", "final.md");
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, merged, "utf-8");
    return merged;
  }

  splitMerged(content: string): SplitResult {
    const stripped = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const markerRe = /<!--\s*section:([^\s]+)\s*-->/g;
    const matches: Array<{ key: string; start: number; headerEnd: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = markerRe.exec(stripped))) {
      matches.push({ key: m[1]!, start: m.index, headerEnd: markerRe.lastIndex });
    }
    if (matches.length >= 2) {
      const sections: Record<string, string> = {};
      for (let i = 0; i < matches.length; i++) {
        const end = i < matches.length - 1 ? matches[i + 1]!.start : stripped.length;
        const body = stripped.slice(matches[i]!.headerEnd, end).trim();
        const key = matches[i]!.key;
        if (key.startsWith("transition.")) continue;
        sections[key] = body;
      }
      return { ok: true, sections, fallbackUsed: "markers" };
    }
    // fallback: H2 Case headings
    const h2CaseRe = /^##\s+Case\s+(\d+)/gm;
    const caseIndices: Array<{ idx: number; offset: number }> = [];
    while ((m = h2CaseRe.exec(stripped))) {
      caseIndices.push({ idx: parseInt(m[1]!, 10), offset: m.index });
    }
    if (caseIndices.length === 0) {
      return { ok: false, reason: "no markers and no H2 Case headings" };
    }
    const sections: Record<string, string> = {};
    const firstCase = caseIndices[0]!;
    sections["opening"] = stripped.slice(0, firstCase.offset).trim();
    for (let i = 0; i < caseIndices.length; i++) {
      const start = caseIndices[i]!.offset;
      const end = i < caseIndices.length - 1 ? caseIndices[i + 1]!.offset : stripped.length;
      const caseId = `case-${String(caseIndices[i]!.idx).padStart(2, "0")}`;
      const body = stripped.slice(start, end);
      if (i === caseIndices.length - 1) {
        // find closing: look for a top-level H1 AFTER the first 10 chars (skip "## Case N" line)
        const searchBody = body.slice(10);
        const h1 = /^#\s+(?!#)/m.exec(searchBody);
        if (h1) {
          sections[`practice.${caseId}`] = body.slice(0, 10 + h1.index).trim();
          sections["closing"] = searchBody.slice(h1.index).trim();
          continue;
        }
      }
      sections[`practice.${caseId}`] = body.trim();
    }
    if (!sections["closing"]) {
      return { ok: false, reason: "fallback could not isolate closing section" };
    }
    return { ok: true, sections, fallbackUsed: "h-headings" };
  }

  async backupBroken(content: string): Promise<string> {
    const ts = Date.now();
    const p = join(this.projectDir, "article", "sections", `_broken_backup_${ts}.md`);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content, "utf-8");
    return p;
  }
}
