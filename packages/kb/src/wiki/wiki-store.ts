import yaml from "js-yaml";
import type { WikiFrontmatter, WikiKind, WikiPage, PatchOp } from "./types.js";
import { mkdirSync, writeFileSync, readFileSync as nodeReadFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, relative, sep, resolve } from "node:path";

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

const VALID_KINDS: ReadonlyArray<WikiKind> = ["entity", "concept", "case", "observation", "person"];

export function parseFrontmatter(text: string): { frontmatter: WikiFrontmatter; body: string } {
  const m = FM_RE.exec(text);
  if (!m) {
    return {
      frontmatter: { type: "entity", title: "", sources: [], last_ingest: "" },
      body: text,
    };
  }
  const yamlBlock = m[1]!;
  const body = m[2] ?? "";
  const raw = (yaml.load(yamlBlock) as Record<string, unknown>) ?? {};
  return { frontmatter: normalize(raw), body };
}

function normalize(raw: Record<string, unknown>): WikiFrontmatter {
  const t = raw.type as string | undefined;
  const type: WikiKind = (t && (VALID_KINDS as readonly string[]).includes(t)) ? (t as WikiKind) : "entity";
  const fm: WikiFrontmatter = {
    type,
    title: (raw.title as string) ?? "",
    aliases: raw.aliases as string[] | undefined,
    sources: (raw.sources as WikiFrontmatter["sources"]) ?? [],
    backlinks: raw.backlinks as string[] | undefined,
    images: raw.images as WikiFrontmatter["images"] | undefined,
    last_ingest: (raw.last_ingest as string) ?? "",
  };
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in fm)) fm[k] = v;
  }
  return fm;
}

export function serializeFrontmatter(fm: WikiFrontmatter, body: string): string {
  const out: Record<string, unknown> = {
    type: fm.type,
    title: fm.title,
  };
  if (fm.aliases && fm.aliases.length > 0) out.aliases = fm.aliases;
  out.sources = fm.sources ?? [];
  if (fm.backlinks && fm.backlinks.length > 0) out.backlinks = fm.backlinks;
  if (fm.images && fm.images.length > 0) out.images = fm.images;
  out.last_ingest = fm.last_ingest;
  for (const [k, v] of Object.entries(fm)) {
    if (k in out) continue;
    if (["type", "title", "aliases", "sources", "backlinks", "images", "last_ingest"].includes(k)) continue;
    out[k] = v;
  }
  const yamlStr = yaml.dump(out, { lineWidth: 200, noRefs: true }).trimEnd();
  return `---\n${yamlStr}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
}

const ALLOWED_DIRS = ["entities", "concepts", "cases", "observations", "persons"] as const;

function assertSafePath(vault: string, rel: string): string {
  const abs = resolve(join(vault, rel));
  const back = relative(vault, abs);
  if (back.startsWith("..") || back.startsWith(sep) || back.includes(".." + sep)) {
    throw new Error(`invalid path (escapes vault): ${rel}`);
  }
  const top = back.split(/[\\/]/)[0];
  if (!ALLOWED_DIRS.includes(top as (typeof ALLOWED_DIRS)[number])) {
    throw new Error(`invalid path (not an allowed kind dir): ${rel}`);
  }
  if (!back.endsWith(".md")) throw new Error(`invalid path (must end with .md): ${rel}`);
  return abs;
}

function dedupeSourceKey() {
  const seen = new Set<string>();
  return (s: { account: string; article_id: string }) => {
    const k = `${s.account}::${s.article_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
}

function dedupeStr(arr: string[]): string[] {
  return Array.from(new Set(arr.filter((x) => x && x.length > 0)));
}

function dedupeImage(arr: WikiFrontmatter["images"] = []): WikiFrontmatter["images"] {
  const seen = new Set<string>();
  const out: NonNullable<WikiFrontmatter["images"]> = [];
  for (const im of arr ?? []) {
    if (seen.has(im.url)) continue;
    seen.add(im.url);
    out.push(im);
  }
  return out;
}

export class WikiStore {
  constructor(private vaultPath: string) {
    mkdirSync(vaultPath, { recursive: true });
  }

  absPath(rel: string): string { return assertSafePath(this.vaultPath, rel); }

  readPage(rel: string): WikiPage | null {
    const abs = this.absPath(rel);
    if (!existsSync(abs)) return null;
    const text = nodeReadFileSync(abs, "utf-8");
    const { frontmatter, body } = parseFrontmatter(text);
    return { path: rel, frontmatter, body };
  }

  writePage(page: WikiPage): void {
    const abs = this.absPath(page.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, serializeFrontmatter(page.frontmatter, page.body), "utf-8");
  }

  listPages(): WikiPage[] {
    const out: WikiPage[] = [];
    for (const kind of ALLOWED_DIRS) {
      const dir = join(this.vaultPath, kind);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".md")) continue;
        const rel = `${kind}/${name}`;
        const p = this.readPage(rel);
        if (p) out.push(p);
      }
    }
    return out;
  }

  applyPatch(op: PatchOp): { created: boolean; updated: boolean; noted?: string } {
    if (op.op === "note") return { created: false, updated: false, noted: op.body };
    const abs = this.absPath(op.path);
    const existed = existsSync(abs);
    const existing = existed ? this.readPage(op.path)! : null;

    if (op.op === "upsert") {
      const base: WikiFrontmatter = existing?.frontmatter ?? {
        type: (op.frontmatter.type as WikiFrontmatter["type"]) ?? "entity",
        title: op.frontmatter.title ?? "",
        sources: [],
        last_ingest: "",
      };
      const merged: WikiFrontmatter = {
        ...base,
        ...op.frontmatter,
        sources: [...(base.sources ?? []), ...((op.frontmatter.sources as WikiFrontmatter["sources"]) ?? [])]
          .filter(dedupeSourceKey()),
        backlinks: dedupeStr([...(base.backlinks ?? []), ...(op.frontmatter.backlinks ?? [])]),
        images: dedupeImage([...(base.images ?? []), ...(op.frontmatter.images ?? [])]),
        last_ingest: op.frontmatter.last_ingest ?? base.last_ingest ?? new Date().toISOString(),
      };
      this.writePage({ path: op.path, frontmatter: merged, body: op.body });
      return { created: !existed, updated: existed };
    }

    if (!existing) throw new Error(`page not found for op ${op.op}: ${op.path}`);

    if (op.op === "append_source") {
      const list = [...(existing.frontmatter.sources ?? [])];
      const key = `${op.source.account}::${op.source.article_id}`;
      if (!list.some((s) => `${s.account}::${s.article_id}` === key)) list.push(op.source);
      existing.frontmatter.sources = list;
      existing.frontmatter.last_ingest = new Date().toISOString();
      this.writePage(existing);
      return { created: false, updated: true };
    }

    if (op.op === "append_image") {
      const list = [...(existing.frontmatter.images ?? [])];
      if (!list.some((im) => im.url === op.image.url)) list.push(op.image);
      existing.frontmatter.images = list;
      this.writePage(existing);
      return { created: false, updated: true };
    }

    if (op.op === "add_backlink") {
      if (op.to === op.path) return { created: false, updated: false };
      const list = dedupeStr([...(existing.frontmatter.backlinks ?? []), op.to]);
      existing.frontmatter.backlinks = list;
      this.writePage(existing);
      const target = this.readPage(op.to);
      if (target) {
        target.frontmatter.backlinks = dedupeStr([...(target.frontmatter.backlinks ?? []), op.path]);
        this.writePage(target);
      }
      return { created: false, updated: true };
    }

    return { created: false, updated: false };
  }
}
