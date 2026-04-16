import yaml from 'js-yaml';
import type {
  ArticleType, PanelFrontmatterV2, PanelV2,
} from './panel-v2-schema.js';
import { ARTICLE_TYPES, TONE_PRIMARY_ENUM } from './panel-v2-schema.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parsePanelV2(absPath: string, raw: string): PanelV2 {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) throw new Error(`panel-v2: no frontmatter at ${absPath}`);
  const fm = yaml.load(match[1]!) as Partial<PanelFrontmatterV2>;
  if (!fm || typeof fm !== 'object') {
    throw new Error(`panel-v2: frontmatter is not an object at ${absPath}`);
  }
  if (fm.version !== 2) {
    throw new Error(`panel-v2: expected version 2, got ${fm.version} at ${absPath}`);
  }
  validateFrontmatter(fm as PanelFrontmatterV2, absPath);
  const body = raw.slice(match[0].length).replace(/^\r?\n/, '');
  return { frontmatter: fm as PanelFrontmatterV2, body, absPath };
}

function validateFrontmatter(fm: PanelFrontmatterV2, path: string): void {
  if (!fm.account) throw new Error(`panel-v2: missing account at ${path}`);
  if (!['opening', 'practice', 'closing'].includes(fm.role)) {
    throw new Error(`panel-v2: invalid role ${fm.role} at ${path}`);
  }
  if (!Array.isArray(fm.types)) {
    throw new Error(`panel-v2: types must be array at ${path}`);
  }
  for (const t of fm.types) {
    if (!ARTICLE_TYPES.includes(t.key)) {
      throw new Error(`panel-v2: invalid type key ${t.key} at ${path}`);
    }
  }
  if (!TONE_PRIMARY_ENUM.includes(fm.tone?.primary)) {
    throw new Error(`panel-v2: invalid tone.primary at ${path}`);
  }
}

/**
 * Extract the body of `## <roleHeading> · <type>模式` up to the next `## ` heading.
 * Returns null if the section is absent.
 */
export function extractTypeSection(body: string, type: ArticleType): string | null {
  const re = new RegExp(
    `(?:^|\\n)##\\s+[^·\\n]+·\\s*${escapeRegex(type)}模式\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    'u',
  );
  const m = body.match(re);
  if (!m) return null;
  return m[1]!.trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
