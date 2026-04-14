import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "@crossing/kb";
import { registerKbWikiRoutes } from "../src/routes/kb-wiki.js";

async function mk(): Promise<{ app: import("fastify").FastifyInstance; vault: string }> {
  const vault = mkdtempSync(join(tmpdir(), "wp-"));
  const store = new WikiStore(vault);
  store.applyPatch({ op: "upsert", path: "entities/A.md", frontmatter: { type: "entity", title: "A" }, body: "# A\n\nbody" });
  store.applyPatch({ op: "upsert", path: "concepts/B.md", frontmatter: { type: "concept", title: "B", aliases: ["b"] }, body: "# B" });
  const sqlitePath = join(vault, "refs.sqlite");
  writeFileSync(sqlitePath, "");
  const app = Fastify();
  registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
  await app.ready();
  return { app, vault };
}

describe("GET /api/kb/wiki/pages", () => {
  it("lists all pages with meta", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/pages" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ path: string; kind: string; title: string }>;
    expect(body).toHaveLength(2);
    const paths = body.map((x) => x.path).sort();
    expect(paths).toEqual(["concepts/B.md", "entities/A.md"]);
    await app.close();
  });

  it("supports ?kind= filter", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/pages?kind=entity" });
    const body = res.json() as Array<{ kind: string }>;
    expect(body.every((x) => x.kind === "entity")).toBe(true);
    expect(body.length).toBe(1);
    await app.close();
  });
});

describe("GET /api/kb/wiki/pages/*", () => {
  it("returns raw markdown for a page", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/pages/entities/A.md" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/markdown|text\/plain/);
    expect(res.body).toContain("# A");
    expect(res.body).toContain("type: entity");
    await app.close();
  });

  it("404 on missing page", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/pages/entities/NOPE.md" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("403 on path-escape attempt", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/pages/../etc/passwd" });
    expect([400, 403, 404]).toContain(res.statusCode);
    await app.close();
  });
});
