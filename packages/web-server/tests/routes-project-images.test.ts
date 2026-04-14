import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectImageRoutes } from "../src/routes/project-images.js";

async function mkApp(): Promise<{ app: FastifyInstance; projectsRoot: string }> {
  const projectsRoot = mkdtempSync(join(tmpdir(), "sp13-img-"));
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  registerProjectImageRoutes(app, { projectsRoot });
  await app.ready();
  return { app, projectsRoot };
}

function makeMultipart(opts: {
  boundary?: string;
  filename?: string;
  contentType?: string;
  payload?: Buffer | string;
  omitFile?: boolean;
}): { body: Buffer; headers: Record<string, string> } {
  const boundary = opts.boundary ?? "----Bd" + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];
  if (!opts.omitFile) {
    const payload = typeof opts.payload === "string" ? Buffer.from(opts.payload) : opts.payload ?? Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    parts.push(Buffer.from([
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${opts.filename ?? "x.png"}"`,
      `Content-Type: ${opts.contentType ?? "image/png"}`,
      "",
      "",
    ].join("\r\n")));
    parts.push(payload);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  } else {
    parts.push(Buffer.from(`--${boundary}--\r\n`));
  }
  return {
    body: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("POST /api/projects/:id/images", () => {
  let app: FastifyInstance;
  let projectsRoot: string;
  beforeEach(async () => {
    const r = await mkApp();
    app = r.app;
    projectsRoot = r.projectsRoot;
  });

  it("uploads a png and returns hashed filename", async () => {
    const mp = makeMultipart({ payload: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/images", payload: mp.body, headers: mp.headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.filename).toMatch(/^[0-9a-f]{16}\.png$/);
    expect(body.url).toBe(`/api/projects/p1/images/${body.filename}`);
    expect(body.bytes).toBe(4);
    expect(body.mime).toBe("image/png");
    expect(existsSync(join(projectsRoot, "p1", "images", body.filename))).toBe(true);
  });

  it("deduplicates identical bytes", async () => {
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const mp1 = makeMultipart({ payload });
    const mp2 = makeMultipart({ payload });
    const r1 = await app.inject({ method: "POST", url: "/api/projects/p1/images", payload: mp1.body, headers: mp1.headers });
    const r2 = await app.inject({ method: "POST", url: "/api/projects/p1/images", payload: mp2.body, headers: mp2.headers });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.json().filename).toBe(r2.json().filename);
  });

  it("rejects text/plain with 415", async () => {
    const mp = makeMultipart({ contentType: "text/plain", filename: "a.txt", payload: "hello" });
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/images", payload: mp.body, headers: mp.headers });
    expect(res.statusCode).toBe(415);
  });

  it("rejects payload over 10MB with 413", async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 0xaa);
    const mp = makeMultipart({ payload: big });
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/images", payload: mp.body, headers: mp.headers });
    expect(res.statusCode).toBe(413);
  });

  it("returns 400 when no file is supplied", async () => {
    const mp = makeMultipart({ omitFile: true });
    const res = await app.inject({ method: "POST", url: "/api/projects/p1/images", payload: mp.body, headers: mp.headers });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/projects/:id/images/:filename", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    const r = await mkApp();
    app = r.app;
  });

  it("serves uploaded image bytes with correct mime", async () => {
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);
    const mp = makeMultipart({ payload });
    const up = await app.inject({ method: "POST", url: "/api/projects/p1/images", payload: mp.body, headers: mp.headers });
    const body = up.json();
    const res = await app.inject({ method: "GET", url: body.url });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/png/);
    expect(Buffer.from(res.rawPayload).equals(payload)).toBe(true);
  });

  it("returns 404 for unknown filename", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/images/deadbeef00000000.png" });
    expect(res.statusCode).toBe(404);
  });

  it("rejects traversal attempt", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p1/images/..%2Fsecrets.txt" });
    expect([400, 404]).toContain(res.statusCode);
    const res2 = await app.inject({ method: "GET", url: "/api/projects/p1/images/foo.exe" });
    expect(res2.statusCode).toBe(400);
  });
});
