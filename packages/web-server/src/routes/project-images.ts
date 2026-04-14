import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, createReadStream, statSync } from "node:fs";
import { join, basename } from "node:path";

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const FILENAME_RE = /^[0-9a-f]{16}\.(png|jpg|gif|webp)$/;

export interface ProjectImageRoutesDeps {
  projectsRoot: string;
}

export function registerProjectImageRoutes(
  app: FastifyInstance,
  deps: ProjectImageRoutesDeps,
): void {
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/images",
    async (req, reply) => {
      let filePart: any;
      try {
        filePart = await (req as any).file();
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        if (err?.code === "FST_REQ_FILE_TOO_LARGE" || /too large|limit/i.test(msg)) {
          return reply.code(413).send({ error: "too large" });
        }
        if (err?.code === "FST_INVALID_MULTIPART_CONTENT_TYPE") {
          return reply.code(400).send({ error: "not multipart" });
        }
        return reply.code(400).send({ error: msg });
      }
      if (!filePart) {
        return reply.code(400).send({ error: "no file" });
      }
      const mime = filePart.mimetype;
      const ext = MIME_TO_EXT[mime];
      if (!ext) {
        // drain to avoid hanging
        try { await filePart.toBuffer(); } catch { /* ignore */ }
        return reply.code(415).send({ error: `unsupported mime: ${mime}` });
      }
      let buf: Buffer;
      try {
        buf = await filePart.toBuffer();
      } catch (err: any) {
        if (err?.code === "FST_REQ_FILE_TOO_LARGE") {
          return reply.code(413).send({ error: "too large" });
        }
        return reply.code(400).send({ error: String(err?.message ?? err) });
      }
      if (filePart.file?.truncated) {
        return reply.code(413).send({ error: "too large" });
      }
      const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
      const filename = `${hash}${ext}`;
      const dir = join(deps.projectsRoot, req.params.id, "images");
      mkdirSync(dir, { recursive: true });
      const target = join(dir, filename);
      if (!existsSync(target)) {
        writeFileSync(target, buf);
      }
      return reply.send({
        url: `/api/projects/${req.params.id}/images/${filename}`,
        filename,
        bytes: buf.length,
        mime,
      });
    },
  );

  app.get<{ Params: { id: string; filename: string } }>(
    "/api/projects/:id/images/:filename",
    async (req, reply) => {
      const { id, filename } = req.params;
      if (!FILENAME_RE.test(filename)) {
        return reply.code(400).send({ error: "invalid filename" });
      }
      const safe = basename(filename);
      if (safe !== filename) {
        return reply.code(400).send({ error: "invalid filename" });
      }
      const abs = join(deps.projectsRoot, id, "images", safe);
      if (!existsSync(abs)) {
        return reply.code(404).send({ error: "not found" });
      }
      const extMatch = /\.[a-z]+$/.exec(safe);
      const mime = extMatch ? EXT_TO_MIME[extMatch[0]] : undefined;
      const { size } = statSync(abs);
      reply.header("content-type", mime ?? "application/octet-stream");
      reply.header("content-length", size);
      return reply.send(createReadStream(abs));
    },
  );
}
