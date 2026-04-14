import yaml from "js-yaml";

export type StylePanelRole = "opening" | "practice" | "closing" | "legacy";

export interface StylePanelFrontmatter {
  account: string;
  role: StylePanelRole;
  version: number;
  status: "active" | "deleted";
  created_at: string;
  source_article_count: number;
  slicer_run_id?: string;
  composer_duration_ms?: number;
}

export interface StylePanel {
  frontmatter: StylePanelFrontmatter;
  body: string;
  absPath: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parsePanel(absPath: string, raw: string): StylePanel {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error("not a style panel: no frontmatter");
  }
  const yamlBlock = match[1];
  const parsed = yaml.load(yamlBlock);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("not a style panel: no frontmatter");
  }
  const body = raw.slice(match[0].length).replace(/^\r?\n/, "");
  return {
    frontmatter: parsed as StylePanelFrontmatter,
    body,
    absPath,
  };
}

export function serializePanel(fm: StylePanelFrontmatter, body: string): string {
  const yamlText = yaml.dump(fm, { lineWidth: -1, noRefs: true });
  return `---\n${yamlText}---\n\n${body}`;
}

export function isLegacy(fm: StylePanelFrontmatter): boolean {
  return fm.role === "legacy";
}
