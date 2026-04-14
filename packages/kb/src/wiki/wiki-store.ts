import yaml from "js-yaml";
import type { WikiFrontmatter, WikiKind } from "./types.js";

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
