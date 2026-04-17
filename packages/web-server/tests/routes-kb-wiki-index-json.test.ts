import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "@crossing/kb";
import { registerKbWikiRoutes } from "../src/routes/kb-wiki.js";

async function mk() {
  const vault = mkdtempSync(join(tmpdir(), "ix-"));
  const store = new WikiStore(vault);
  store.applyPatch({ op: "upsert", path: "entities/A.md", frontmatter: { type: "entity", title: "A", aliases: ["a1", "a2"] }, body: "# A" });
  store.applyPatch({ op: "upsert", path: "concepts/B.md", frontmatter: { type: "concept", title: "B" }, body: "# B" });
  const sqlitePath = join(vault, "refs.sqlite");
  writeFileSync(sqlitePath, "");
  const app = Fastify();
  registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
  await app.ready();
  return { app };
}

describe("GET /api/kb/wiki/index.json", () => {
  it("returns path/title/aliases for all pages", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/index.json" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ path: string; title: string; aliases: string[] }>;
    expect(body).toHaveLength(2);
    const a = body.find((b) => b.path === "entities/A.md");
    expect(a?.title).toBe("A");
    expect(a?.aliases).toEqual(["a1", "a2"]);
    const b = body.find((b) => b.path === "concepts/B.md");
    expect(b?.aliases).toEqual([]);
    await app.close();
  });

  it("sets cache-control max-age=60", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/index.json" });
    expect(res.headers["cache-control"]).toMatch(/max-age=60/);
    await app.close();
  });
});
