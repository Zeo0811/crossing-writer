import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  createReadStream,
  statSync,
} from "node:fs";
import { join, basename, extname } from "node:path";

const IMAGE_MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

const FILE_MIME_WHITELIST = new Set<string>([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

const FILE_EXT_WHITELIST = new Set<string>([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".zip",
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const IMAGE_FILENAME_RE = /^[0-9a-f]{16}\.[a-z0-9]+$/i;
const FILE_FILENAME_RE = /^[0-9a-f]{16}-[^/\\]+$/;

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
};

export interface BriefAttachmentsDeps {
  projectsRoot: string;
}

export interface BriefAttachmentItem {
  kind: "image" | "file";
  url: string;
  filename: string;
  size: number;
  mime: string;
}

function isAllowedFile(mime: string, originalName: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (FILE_MIME_WHITELIST.has(mime)) return true;
  const ext = extname(originalName).toLowerCase();
  if (FILE_EXT_WHITELIST.has(ext)) return true;
  return false;
}

function safeName(name: string): string {
  return name.replace(/[\/\\\0\r\n]/g, "_").replace(/^\.+/, "_");
}

export function registerBriefAttachmentsRoutes(
  app: FastifyInstance,
  deps: BriefAttachmentsDeps,
): void {
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/brief/attachments",
    async (req, reply) => {
      const { id } = req.params;
      const briefDir = join(deps.projectsRoot, id, "brief");
      const imagesDir = join(briefDir, "images");
      const filesDir = join(briefDir, "attachments");

      const items: BriefAttachmentItem[] = [];

      let parts: AsyncIterableIterator<any>;
      try {
        parts = (req as any).files();
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (err?.code === "FST_INVALID_MULTIPART_CONTENT_TYPE") {
          return reply.code(400).send({ error: "not multipart" });
        }
        return reply.code(400).send({ error: msg });
      }

      try {
        for await (const part of parts) {
          if (!part.file) continue;
          const mime: string = part.mimetype || "application/octet-stream";
          const original = safeName(part.filename || "file");
          const isImage = mime.startsWith("image/");

          if (!isImage && !isAllowedFile(mime, original)) {
            try { await part.toBuffer(); } catch { /* drain */ }
            return reply
              .code(400)
              .send({ error: `unsupported mime: ${mime}` });
          }

          let buf: Buffer;
          try {
            buf = await part.toBuffer();
          } catch (err: any) {
            if (err?.code === "FST_REQ_FILE_TOO_LARGE") {
              return reply.code(400).send({ error: "too large" });
            }
            return reply.code(400).send({ error: String(err?.message ?? err) });
          }
          if (part.file?.truncated) {
            return reply.code(400).send({ error: "too large" });
          }
          if (buf.length > MAX_FILE_SIZE) {
            return reply.code(400).send({ error: "too large" });
          }

          const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);

          if (isImage) {
            const ext =
              IMAGE_MIME_TO_EXT[mime] ||
              (extname(original).toLowerCase() || ".bin");
            const filename = `${hash}${ext}`;
            mkdirSync(imagesDir, { recursive: true });
            const target = join(imagesDir, filename);
            if (!existsSync(target)) writeFileSync(target, buf);
            items.push({
              kind: "image",
              url: `images/${filename}`,
              filename: original,
              size: buf.length,
              mime,
            });
          } else {
            const filename = `${hash}-${original}`;
            mkdirSync(filesDir, { recursive: true });
            const target = join(filesDir, filename);
            if (!existsSync(target)) writeFileSync(target, buf);
            items.push({
              kind: "file",
              url: `attachments/${filename}`,
              filename: original,
              size: buf.length,
              mime,
            });
          }
        }
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (err?.code === "FST_REQ_FILE_TOO_LARGE" || /too large/i.test(msg)) {
          return reply.code(400).send({ error: "too large" });
        }
        return reply.code(400).send({ error: msg });
      }

      if (items.length === 0) {
        return reply.code(400).send({ error: "no files" });
      }
      return reply.send({ items });
    },
  );

  app.get<{ Params: { id: string; filename: string } }>(
    "/api/projects/:id/brief/images/:filename",
    async (req, reply) => {
      const { id, filename } = req.params;
      if (!IMAGE_FILENAME_RE.test(filename)) {
        return reply.code(400).send({ error: "invalid filename" });
      }
      const safe = basename(filename);
      if (safe !== filename) {
        return reply.code(400).send({ error: "invalid filename" });
      }
      const abs = join(deps.projectsRoot, id, "brief", "images", safe);
      if (!existsSync(abs)) {
        return reply.code(404).send({ error: "not found" });
      }
      const ext = extname(safe).toLowerCase();
      const mime = EXT_TO_MIME[ext] ?? "application/octet-stream";
      const { size } = statSync(abs);
      reply.header("content-type", mime);
      reply.header("content-length", size);
      return reply.send(createReadStream(abs));
    },
  );

  app.get<{ Params: { id: string; filename: string } }>(
    "/api/projects/:id/brief/files/:filename",
    async (req, reply) => {
      const { id, filename } = req.params;
      if (!FILE_FILENAME_RE.test(filename)) {
        return reply.code(400).send({ error: "invalid filename" });
      }
      const safe = basename(filename);
      if (safe !== filename) {
        return reply.code(400).send({ error: "invalid filename" });
      }
      const abs = join(deps.projectsRoot, id, "brief", "attachments", safe);
      if (!existsSync(abs)) {
        return reply.code(404).send({ error: "not found" });
      }
      const ext = extname(safe).toLowerCase();
      const mime = EXT_TO_MIME[ext] ?? "application/octet-stream";
      const { size } = statSync(abs);
      reply.header("content-type", mime);
      reply.header("content-length", size);
      // Force download for non-image files
      const originalName = safe.slice(17); // skip "<hash>-"
      reply.header(
        "content-disposition",
        `inline; filename="${encodeURIComponent(originalName)}"`,
      );
      return reply.send(createReadStream(abs));
    },
  );
}
