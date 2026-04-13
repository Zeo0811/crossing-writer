import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { join, extname } from "node:path";

const SUPPORTED = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_IMAGES_PER_PROJECT = 30;

export interface ImageInfo {
  filename: string;
  source: "brief" | "screenshot";
  relPath: string;
  absPath: string;
  label?: string;
}

export interface SaveInput {
  projectId: string;
  filename: string;
  buffer: Buffer;
  source: "brief" | "screenshot";
  label?: string;
}

export class ImageStore {
  constructor(private projectsRoot: string) {}

  private dir(projectId: string): string {
    return join(this.projectsRoot, projectId, "context", "images");
  }

  async list(projectId: string): Promise<ImageInfo[]> {
    const d = this.dir(projectId);
    try {
      const entries = await readdir(d);
      return entries
        .filter((n) => SUPPORTED.has(extname(n).toLowerCase()))
        .map((n): ImageInfo => ({
          filename: n,
          source: n.startsWith("brief-fig-") ? "brief" : "screenshot",
          relPath: `context/images/${n}`,
          absPath: join(d, n),
        }))
        .sort((a, b) => a.filename.localeCompare(b.filename));
    } catch (e: any) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }

  async save(input: SaveInput): Promise<ImageInfo> {
    const ext = extname(input.filename).toLowerCase();
    if (!SUPPORTED.has(ext)) {
      throw new Error(`unsupported image format: ${ext}`);
    }
    const existing = await this.list(input.projectId);
    if (existing.length >= MAX_IMAGES_PER_PROJECT) {
      throw new Error(`image limit reached: ${MAX_IMAGES_PER_PROJECT}`);
    }
    const prefix = input.source === "brief" ? "brief-fig" : "screenshot";
    const sameSourceCount = existing.filter((i) => i.source === input.source).length;
    const fname = `${prefix}-${sameSourceCount + 1}${ext}`;
    const d = this.dir(input.projectId);
    await mkdir(d, { recursive: true });
    const abs = join(d, fname);
    await writeFile(abs, input.buffer);
    return {
      filename: fname,
      source: input.source,
      relPath: `context/images/${fname}`,
      absPath: abs,
      label: input.label,
    };
  }

  async delete(projectId: string, filename: string): Promise<void> {
    const abs = join(this.dir(projectId), filename);
    await unlink(abs);
  }
}
