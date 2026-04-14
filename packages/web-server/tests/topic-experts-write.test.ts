import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { TopicExpertStore } from "../src/services/topic-expert-store.js";
import { registerTopicExpertsRoutes } from "../src/routes/topic-experts.js";

function seedVault() {
  const root = mkdtempSync(join(tmpdir(), "vault-te-w-"));
  mkdirSync(join(root, "08_experts/topic-panel/experts"), { recursive: true });
  const fm = `---\nname: alice\nspecialty: zen\n---\nbody-a`;
  writeFileSync(join(root, "08_experts/topic-panel/experts/alice_kb.md"), fm, "utf-8");
  return root;
}

async function buildApp(root: string) {
  const store = new TopicExpertStore(root);
  const app = Fastify();
  registerTopicExpertsRoutes(app, { store });
  await app.ready();
  return { app, root };
}

describe("topic-experts create/delete routes", () => {
  let root: string;
  beforeEach(() => { root = seedVault(); });

  it("POST creates new expert", async () => {
    const { app } = await buildApp(root);
    const r = await app.inject({
      method: "POST", url: "/api/topic-experts",
      payload: { name: "bob", specialty: "hard" },
    });
    expect(r.statusCode).toBe(200);
    const j = r.json() as any;
    expect(j.ok).toBe(true);
    expect(j.expert.name).toBe("bob");
    const list = await app.inject({ method: "GET", url: "/api/topic-experts" });
    const names = (list.json() as any).experts.map((e: any) => e.name).sort();
    expect(names).toEqual(["alice", "bob"]);
  });

  it("POST duplicate returns 409", async () => {
    const { app } = await buildApp(root);
    const r = await app.inject({
      method: "POST", url: "/api/topic-experts",
      payload: { name: "alice", specialty: "zen" },
    });
    expect(r.statusCode).toBe(409);
  });

  it("DELETE default is soft; list hides it", async () => {
    const { app } = await buildApp(root);
    const r = await app.inject({ method: "DELETE", url: "/api/topic-experts/alice" });
    expect(r.statusCode).toBe(200);
    expect((r.json() as any).mode).toBe("soft");
    const list = await app.inject({ method: "GET", url: "/api/topic-experts" });
    expect((list.json() as any).experts.length).toBe(0);
  });

  it("DELETE mode=hard moves file to .trash", async () => {
    const { app, root: r } = await buildApp(root);
    const res = await app.inject({
      method: "DELETE", url: "/api/topic-experts/alice?mode=hard",
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as any).mode).toBe("hard");
    expect(existsSync(join(r, "08_experts/topic-panel/experts/alice_kb.md"))).toBe(false);
    const trash = readdirSync(join(r, "08_experts/topic-panel/.trash"));
    expect(trash.some((f) => f.startsWith("alice_kb."))).toBe(true);
  });

  it("DELETE hard=1 alias", async () => {
    const { app, root: r } = await buildApp(root);
    const res = await app.inject({ method: "DELETE", url: "/api/topic-experts/alice?hard=1" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as any).mode).toBe("hard");
    expect(existsSync(join(r, "08_experts/topic-panel/experts/alice_kb.md"))).toBe(false);
  });
});
