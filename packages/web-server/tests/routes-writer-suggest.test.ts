import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

vi.mock("@crossing/kb", () => ({
  searchWiki: vi.fn(async () => [{ path: "entities/AI.Talk.md", frontmatter: { title: "AI.Talk", summary: "AI studio" }, excerpt: "AI studio" }]),
  searchRaw: vi.fn(() => [{ article_id: "abc", title: "Top100", account: "花叔", published_at: "2024-08-28", snippet: "<b>AI</b>..." }]),
}));

import { registerWriterSuggestRoutes } from "../src/routes/writer-suggest.js";

async function seed() {
  const app = Fastify();
  registerWriterSuggestRoutes(app, { vaultPath: "/tmp/v", sqlitePath: "/tmp/kb.sqlite" });
  await app.ready();
  return app;
}

describe("GET /api/writer/suggest", () => {
  it("empty query returns empty list", async () => {
    const app = await seed();
    const res = await app.inject({ method: "GET", url: "/api/writer/suggest?q=" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });
  it("merges wiki-first then raw", async () => {
    const app = await seed();
    const res = await app.inject({ method: "GET", url: "/api/writer/suggest?q=AI" });
    const body = res.json();
    expect(body.items[0].kind).toBe("wiki");
    expect(body.items[0].title).toBe("AI.Talk");
    expect(body.items[1].kind).toBe("raw");
    expect(body.items[1].account).toBe("花叔");
  });
  it("respects limit param", async () => {
    const app = await seed();
    const res = await app.inject({ method: "GET", url: "/api/writer/suggest?q=AI&limit=1" });
    expect(res.json().items.length).toBe(1);
  });
});
