export interface ExtractedImage { url: string; caption?: string }

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_RE = /\bsrc\s*=\s*["']([^"']+)["']/i;
const ALT_RE = /\balt\s*=\s*["']([^"']*)["']/i;

export function extractImagesFromHtml(html: string): ExtractedImage[] {
  const seen = new Set<string>();
  const out: ExtractedImage[] = [];
  const tags = html.match(IMG_TAG) ?? [];
  for (const tag of tags) {
    const srcM = SRC_RE.exec(tag);
    if (!srcM) continue;
    const url = srcM[1]!;
    if (url.startsWith("data:")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const altM = ALT_RE.exec(tag);
    out.push({ url, ...(altM && altM[1] ? { caption: altM[1] } : {}) });
  }
  return out;
}

const MD_IMG = /!\[([^\]]*)\]\(([^)]+)\)/g;

export function extractImagesFromMarkdown(md: string): ExtractedImage[] {
  const seen = new Set<string>();
  const out: ExtractedImage[] = [];
  let m: RegExpExecArray | null;
  while ((m = MD_IMG.exec(md)) !== null) {
    const url = m[2]!.trim();
    if (!url || url.startsWith("data:")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const alt = m[1]!.trim();
    out.push({ url, ...(alt ? { caption: alt } : {}) });
  }
  return out;
}
