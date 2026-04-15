import { extname, join, basename } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

export interface ExtractOptions {
  imageSaveDir?: string;    // abs path; if set, docx images saved here
  imageUrlPrefix?: string;  // e.g. "images/" so markdown becomes ![alt](images/xx.png)
}

export async function extractToMarkdown(
  buffer: Buffer,
  filename: string,
  opts: ExtractOptions = {},
): Promise<string> {
  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case ".md":
    case ".markdown":
    case ".txt":
      return buffer.toString("utf-8");
    case ".docx": {
      const mammoth = (await import("mammoth")).default as any;
      const convertOpts: any = {};
      if (opts.imageSaveDir) {
        mkdirSync(opts.imageSaveDir, { recursive: true });
        const urlPrefix = opts.imageUrlPrefix ?? "images/";
        convertOpts.convertImage = mammoth.images.imgElement(async (image: any) => {
          const imgBuf = await image.read();
          const mime: string = image.contentType ?? "image/png";
          const extFromMime = mime.split("/")[1]?.split("+")[0] ?? "png";
          const hash = createHash("sha256").update(imgBuf).digest("hex").slice(0, 16);
          const fn = `${hash}.${extFromMime}`;
          writeFileSync(join(opts.imageSaveDir!, fn), imgBuf);
          return { src: `${urlPrefix}${fn}` };
        });
      }
      const result = await mammoth.convertToMarkdown({ buffer }, convertOpts);
      return result.value as string;
    }
    case ".pdf": {
      const pdf = (await import("pdf-parse")).default;
      const result = await pdf(buffer);
      return result.text;
    }
    default:
      throw new Error(`unsupported file type: ${ext}`);
  }
}

export function _unused() { basename; }  // keep import
