import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { TopicExpertStore } from "../src/services/topic-expert-store.js";
import { registerTopicExpertsRoutes } from "../src/routes/topic-experts.js";

function seedVault(entries: Array<{ name: string; body: string; specialty?: string }>) {
  const root = mkdtempSync(join(tmpdir(), "vault-te-"));
  mkdirSync(join(root, "08_experts/topic-panel/experts"), { recursive: true });
  for (const e of entries) {
    const fm = `---\nname: ${e.name}\nspecialty: ${e.specialty ?? ""}\n---\n${e.body}`;
    writeFileSync(join(root, `08_experts/topic-panel/experts/${e.name}_kb.md`), fm, "utf-8");
  }
  return root;
}

async function buildApp(root: string) {
  const store = new TopicExpertStore(root);
  const app = Fastify();
  registerTopicExpertsRoutes(app, { store });
  await app.ready();
  return { app, store };
}

describe("topic-experts read/update routes", () => {
  let root: string;
  beforeEach(() => {
    root = seedVault([
      { name: "alice", body: "A", specialty: "zen" },
      { name: "bob", body: "B", specialty: "hard" },
    ]);
  });

  it("list returns seeded entries", async () => {
    const { app } = await buildApp(root);
    const res = await app.inject({ method: "GET", url: "/api/topic-experts" });
    expect(res.statusCode).toBe(200);
    const j = res.json() as { experts: Array<{ name: string }> };
    expect(j.experts.map((e) => e.name).sort()).toEqual(["alice", "bob"]);
  });

  it("list hides soft_deleted unless include_deleted=1", async () => {
    const { app, store } = await buildApp(root);
    await store.softDelete("alice");
    const r1 = await app.inject({ method: "GET", url: "/api/topic-experts" });
    const j1 = r1.json() as { experts: Array<{ name: string }> };
    expect(j1.experts.map((e) => e.name)).toEqual(["bob"]);
    const r2 = await app.inject({ method: "GET", url: "/api/topic-experts?include_deleted=1" });
    const j2 = r2.json() as { experts: Array<{ name: string }> };
    expect(j2.experts.length).toBe(2);
  });

  it("get returns 404 for unknown", async () => {
    const { app } = await buildApp(root);
    const res = await app.inject({ method: "GET", url: "/api/topic-experts/unknown" });
    expect(res.statusCode).toBe(404);
  });

  it("put toggles active", async () => {
    const { app } = await buildApp(root);
    const r1 = await app.inject({
      method: "PUT",
      url: "/api/topic-experts/alice",
      payload: { active: false },
    });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({ method: "GET", url: "/api/topic-experts/alice" });
    expect(r2.statusCode).toBe(200);
    expect((r2.json() as any).active).toBe(false);
  });

  it("put with kb_markdown writes body", async () => {
    const { app } = await buildApp(root);
    const r = await app.inject({
      method: "PUT",
      url: "/api/topic-experts/alice",
      payload: { kb_markdown: "new body xyz" },
    });
    expect(r.statusCode).toBe(200);
    const r2 = await app.inject({ method: "GET", url: "/api/topic-experts/alice" });
    expect((r2.json() as any).kb_markdown).toContain("new body xyz");
  });
});
