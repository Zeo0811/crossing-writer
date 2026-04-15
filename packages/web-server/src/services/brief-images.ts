import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

export interface CollectedProjectImages {
  images: string[];
  addDirs: string[];
}

async function listImagesIn(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  try {
    const entries = await readdir(dir);
    return entries
      .filter((n) => IMAGE_EXTS.has(extname(n).toLowerCase()))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

function extractMarkdownImageRefs(src: string, baseDir: string): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const ref = m[1]!.trim();
    if (!ref) continue;
    if (ref.startsWith("http://") || ref.startsWith("https://")) continue;
    const clean = ref.split(/\s+/)[0]!;
    if (clean.startsWith("/")) out.push(clean);
    else out.push(join(baseDir, clean));
  }
  return out;
}

/**
 * Collect every image file that should be passed as @-ref attachments to any
 * downstream agent invocation in this project, plus the set of `--add-dir`
 * roots those paths live under so the claude CLI can read them.
 *
 * Sources scanned:
 *   - projectDir/brief/images/**            (uploaded brief figures)
 *   - projectDir/context/images/**          (ImageStore — brief-fig-* + screenshot-*)
 *   - markdown @-refs inside brief/brief.md + brief/brief-summary.md
 *   - markdown @-refs inside context/product-overview.md
 *
 * Returns absolute paths (deduplicated) and addDirs = [projectDir].
 */
export async function collectProjectImages(
  projectDir: string,
): Promise<CollectedProjectImages> {
  const briefDir = join(projectDir, "brief");
  const briefImagesDir = join(briefDir, "images");
  const contextImagesDir = join(projectDir, "context", "images");

  const collected = new Set<string>();

  for (const f of await listImagesIn(briefImagesDir)) collected.add(f);
  for (const f of await listImagesIn(contextImagesDir)) collected.add(f);

  const briefMd = join(briefDir, "brief.md");
  const briefSummaryMd = join(briefDir, "brief-summary.md");
  const productOverviewMd = join(projectDir, "context", "product-overview.md");

  for (const [path, base] of [
    [briefMd, briefDir],
    [briefSummaryMd, briefDir],
    [productOverviewMd, join(projectDir, "context")],
  ] as const) {
    if (!existsSync(path)) continue;
    try {
      const body = await readFile(path, "utf-8");
      for (const p of extractMarkdownImageRefs(body, base)) collected.add(p);
    } catch {
      /* ignore */
    }
  }

  return {
    images: Array.from(collected),
    addDirs: [projectDir],
  };
}
