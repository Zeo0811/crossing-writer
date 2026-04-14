import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "@crossing/kb";
import { registerKbWikiRoutes } from "../src/routes/kb-wiki.js";

async function mk() {
  const vault = mkdtempSync(join(tmpdir(), "wss-"));
  const store = new WikiStore(vault);
  store.applyPatch({ op: "upsert", path: "entities/Alice.md", frontmatter: { type: "entity", title: "Alice", aliases: ["A"], last_ingest: "2026-04-14T00:00:00Z" }, body: "Alice is a researcher" });
  store.applyPatch({ op: "upsert", path: "concepts/RAG.md", frontmatter: { type: "concept", title: "RAG", last_ingest: "2026-04-14T00:00:00Z" }, body: "Retrieval Augmented Generation" });
  const sqlitePath = join(vault, "refs.sqlite");
  writeFileSync(sqlitePath, "");
  const app = Fastify();
  registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
  await app.ready();
  return { app, vault };
}

describe("GET /api/kb/wiki/search", () => {
  it("returns ranked results", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/search?q=Alice" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ path: string; score: number }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].path).toBe("entities/Alice.md");
    await app.close();
  });

  it("supports kind filter and limit", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/search?q=R&kind=concept&limit=1" });
    const body = res.json() as Array<{ kind: string }>;
    expect(body.length).toBeLessThanOrEqual(1);
    expect(body.every((x) => x.kind === "concept")).toBe(true);
    await app.close();
  });

  it("400 on missing q", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/search" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /api/kb/wiki/status", () => {
  it("reports counts per kind + last_ingest", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; by_kind: Record<string, number>; last_ingest_at: string | null };
    expect(body.total).toBe(2);
    expect(body.by_kind.entity).toBe(1);
    expect(body.by_kind.concept).toBe(1);
    expect(body.last_ingest_at).toBe("2026-04-14T00:00:00Z");
    await app.close();
  });
});
