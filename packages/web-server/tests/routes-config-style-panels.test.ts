import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { registerConfigStylePanelsRoutes } from "../src/routes/config-style-panels.js";

function seeded() {
  const vault = mkdtempSync(join(tmpdir(), "sp10-r-"));
  const store = new StylePanelStore(vault);
  store.write({
    frontmatter: { account: "A", role: "opening", version: 1, status: "active", created_at: "t", source_article_count: 1 },
    body: "x",
    absPath: "",
  });
  store.write({
    frontmatter: { account: "A", role: "opening", version: 2, status: "active", created_at: "t", source_article_count: 1 },
    body: "x",
    absPath: "",
  });
  store.write({
    frontmatter: { account: "B", role: "closing", version: 1, status: "active", created_at: "t", source_article_count: 1 },
    body: "y",
    absPath: "",
  });
  const app = Fastify();
  registerConfigStylePanelsRoutes(app, { stylePanelStore: store });
  return { app, store, vault };
}

describe("config-style-panels routes", () => {
  it("GET /api/config/style-panels returns all by default (active-only)", async () => {
    const { app } = seeded();
    const r = await app.inject({ method: "GET", url: "/api/config/style-panels" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.panels).toHaveLength(3);
  });

  it("GET ?account=A&role=opening filters", async () => {
    const { app } = seeded();
    const r = await app.inject({
      method: "GET",
      url: "/api/config/style-panels?account=A&role=opening",
    });
    const body = JSON.parse(r.body);
    expect(body.panels).toHaveLength(2);
    expect(body.panels.every((p: any) => p.account === "A" && p.role === "opening")).toBe(true);
  });

  it("DELETE soft marks status=deleted, file still on disk", async () => {
    const { app, store } = seeded();
    const r = await app.inject({
      method: "DELETE",
      url: "/api/config/style-panels/A/opening/2",
    });
    expect(r.statusCode).toBe(200);
    expect(store.getLatestActive("A", "opening")!.frontmatter.version).toBe(1);
    // soft delete: still in list (but status=deleted)
    const all = store.list();
    const v2 = all.find((p) => p.frontmatter.account === "A" && p.frontmatter.version === 2);
    expect(v2?.frontmatter.status).toBe("deleted");
  });

  it("DELETE ?hard=1 removes file", async () => {
    const { app, store, vault } = seeded();
    const filePath = join(vault, "08_experts", "style-panel", "A", "opening-v1.md");
    expect(existsSync(filePath)).toBe(true);
    const r = await app.inject({
      method: "DELETE",
      url: "/api/config/style-panels/A/opening/1?hard=1",
    });
    expect(r.statusCode).toBe(200);
    expect(existsSync(filePath)).toBe(false);
    expect(store.list().filter((p) => p.frontmatter.account === "A" && p.frontmatter.version === 1)).toHaveLength(0);
  });

  it("DELETE unknown returns 404", async () => {
    const { app } = seeded();
    const r = await app.inject({
      method: "DELETE",
      url: "/api/config/style-panels/Z/opening/99",
    });
    expect(r.statusCode).toBe(404);
  });

  it("GET include_deleted=0 hides deleted", async () => {
    const { app, store } = seeded();
    store.softDelete("A", "opening", 1);
    const r = await app.inject({
      method: "GET",
      url: "/api/config/style-panels?account=A&role=opening",
    });
    const body = JSON.parse(r.body);
    expect(body.panels.filter((p: any) => p.version === 1)).toHaveLength(0);
  });

  it("GET include_deleted=1 includes deleted", async () => {
    const { app, store } = seeded();
    store.softDelete("A", "opening", 1);
    const r = await app.inject({
      method: "GET",
      url: "/api/config/style-panels?account=A&role=opening&include_deleted=1",
    });
    const body = JSON.parse(r.body);
    expect(body.panels).toHaveLength(2);
  });
});
