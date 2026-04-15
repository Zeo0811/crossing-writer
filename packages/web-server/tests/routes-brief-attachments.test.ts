import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { registerBriefAttachmentsRoutes } from "../src/routes/brief-attachments.js";

async function mkApp(): Promise<{ app: FastifyInstance; projectsRoot: string }> {
  const projectsRoot = mkdtempSync(join(tmpdir(), "sp20-att-"));
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 10 } });
  registerBriefAttachmentsRoutes(app, { projectsRoot });
  await app.ready();
  return { app, projectsRoot };
}

interface FilePart {
  name?: string;
  filename: string;
  contentType: string;
  payload: Buffer | string;
}

function makeMultipart(files: FilePart[]): { body: Buffer; headers: Record<string, string> } {
  const boundary = "----Bd" + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];
  for (const f of files) {
    const payload = typeof f.payload === "string" ? Buffer.from(f.payload) : f.payload;
    parts.push(
      Buffer.from(
        [
          `--${boundary}`,
          `Content-Disposition: form-data; name="${f.name ?? "file"}"; filename="${f.filename}"`,
          `Content-Type: ${f.contentType}`,
          "",
          "",
        ].join("\r\n"),
      ),
    );
    parts.push(payload);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("POST /api/projects/:id/brief/attachments", () => {
  let app: FastifyInstance;
  let projectsRoot: string;
  beforeEach(async () => {
    const r = await mkApp();
    app = r.app;
    projectsRoot = r.projectsRoot;
  });

  it("uploads single image and returns hashed image url", async () => {
    const mp = makeMultipart([
      { filename: "logo.png", contentType: "image/png", payload: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/brief/attachments",
      payload: mp.body,
      headers: mp.headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].kind).toBe("image");
    expect(body.items[0].filename).toBe("logo.png");
    expect(body.items[0].url).toMatch(/^images\/[0-9a-f]{16}\.png$/);
    const hashed = body.items[0].url.replace("images/", "");
    expect(existsSync(join(projectsRoot, "p1", "brief", "images", hashed))).toBe(true);
  });

  it("uploads single PDF file under attachments", async () => {
    const mp = makeMultipart([
      { filename: "deck.pdf", contentType: "application/pdf", payload: Buffer.from("%PDF-1.4\n") },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/brief/attachments",
      payload: mp.body,
      headers: mp.headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].kind).toBe("file");
    expect(body.items[0].filename).toBe("deck.pdf");
    expect(body.items[0].url).toMatch(/^attachments\/[0-9a-f]{16}-deck\.pdf$/);
    const fname = body.items[0].url.replace("attachments/", "");
    expect(existsSync(join(projectsRoot, "p1", "brief", "attachments", fname))).toBe(true);
  });

  it("uploads multiple files at once (image + pdf)", async () => {
    const mp = makeMultipart([
      { filename: "a.png", contentType: "image/png", payload: Buffer.from([0x89, 1, 2]) },
      { filename: "b.pdf", contentType: "application/pdf", payload: Buffer.from("%PDF") },
      { filename: "c.txt", contentType: "text/plain", payload: "hello" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/brief/attachments",
      payload: mp.body,
      headers: mp.headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(3);
    expect(body.items[0].kind).toBe("image");
    expect(body.items[1].kind).toBe("file");
    expect(body.items[2].kind).toBe("file");
  });

  it("rejects unsupported mime with 400", async () => {
    const mp = makeMultipart([
      { filename: "evil.exe", contentType: "application/x-msdownload", payload: Buffer.from([0x4d, 0x5a]) },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/brief/attachments",
      payload: mp.body,
      headers: mp.headers,
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects payload over 20MB with 400", async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 0xaa);
    const mp = makeMultipart([{ filename: "huge.pdf", contentType: "application/pdf", payload: big }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/brief/attachments",
      payload: mp.body,
      headers: mp.headers,
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when no files supplied", async () => {
    const boundary = "----Empty";
    const body = Buffer.from(`--${boundary}--\r\n`);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/brief/attachments",
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("serves uploaded image bytes back", async () => {
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
    const mp = makeMultipart([{ filename: "x.png", contentType: "image/png", payload }]);
    const up = await app.inject({
      method: "POST",
      url: "/api/projects/p1/brief/attachments",
      payload: mp.body,
      headers: mp.headers,
    });
    const item = up.json().items[0];
    const fname = item.url.replace("images/", "");
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/brief/images/${fname}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/png/);
    expect(Buffer.from(res.rawPayload).equals(payload)).toBe(true);
  });

  it("serves uploaded file bytes back", async () => {
    const payload = Buffer.from("hello-text-file");
    const mp = makeMultipart([{ filename: "note.txt", contentType: "text/plain", payload }]);
    const up = await app.inject({
      method: "POST",
      url: "/api/projects/p1/brief/attachments",
      payload: mp.body,
      headers: mp.headers,
    });
    const item = up.json().items[0];
    const fname = item.url.replace("attachments/", "");
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/brief/files/${fname}`,
    });
    expect(res.statusCode).toBe(200);
    expect(Buffer.from(res.rawPayload).equals(payload)).toBe(true);
  });

  it("rejects traversal attempts on image route", async () => {
    const r1 = await app.inject({ method: "GET", url: "/api/projects/p1/brief/images/..%2Fsecrets.txt" });
    expect([400, 404]).toContain(r1.statusCode);
    const r2 = await app.inject({ method: "GET", url: "/api/projects/p1/brief/images/foo.png" });
    expect(r2.statusCode).toBe(400);
  });

  it("rejects traversal attempts on file route", async () => {
    const r1 = await app.inject({ method: "GET", url: "/api/projects/p1/brief/files/..%2Fsecrets.txt" });
    expect([400, 404]).toContain(r1.statusCode);
    const r2 = await app.inject({ method: "GET", url: "/api/projects/p1/brief/files/notvalidname.pdf" });
    expect(r2.statusCode).toBe(400);
  });

  it("returns 404 for unknown image filename", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/projects/p1/brief/images/deadbeef00000000.png",
    });
    expect(res.statusCode).toBe(404);
  });
});
