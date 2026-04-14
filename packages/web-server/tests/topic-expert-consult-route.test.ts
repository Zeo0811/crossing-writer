import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { TopicExpertStore } from "../src/services/topic-expert-store.js";
import { registerTopicExpertConsultRoutes } from "../src/routes/topic-expert-consult.js";

function seedVault(names: string[]) {
  const root = mkdtempSync(join(tmpdir(), "vault-ce-"));
  mkdirSync(join(root, "08_experts/topic-panel/experts"), { recursive: true });
  for (const n of names) {
    writeFileSync(
      join(root, `08_experts/topic-panel/experts/${n}_kb.md`),
      `---\nname: ${n}\nspecialty: zen\n---\nkb-${n}`,
      "utf-8",
    );
  }
  return root;
}

async function buildApp(root: string, invoke: any) {
  const store = new TopicExpertStore(root);
  const app = Fastify();
  registerTopicExpertConsultRoutes(app, { store, invoke });
  await app.ready();
  return app;
}

function parseSseEvents(raw: string): Array<{ type: string; data: any }> {
  const blocks = raw.split(/\n\n/).filter((b) => b.trim());
  return blocks.map((b) => {
    const lines = b.split(/\n/);
    const type = lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "";
    const data = lines.find((l) => l.startsWith("data: "))?.slice(6) ?? "{}";
    return { type, data: JSON.parse(data) };
  });
}

describe("POST /api/projects/:id/topic-experts/consult (SSE)", () => {
  let root: string;
  beforeEach(() => { root = seedVault(["A", "B"]); });

  it("2-expert happy path", async () => {
    const invoke = vi.fn(async (a: any) => ({
      markdown: `md-${a.name}`, meta: { cli: "claude", durationMs: 1 },
    }));
    const app = await buildApp(root, invoke);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/topic-experts/consult",
      payload: { selected: ["A", "B"], invokeType: "score", brief: "b", productContext: "pc" },
    });
    expect(res.statusCode).toBe(200);
    const events = parseSseEvents(res.payload);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("topic_consult.started");
    expect(types.at(-1)).toBe("all_done");
    expect(types.filter((t) => t === "expert_done")).toHaveLength(2);
  });

  it("empty selected returns 400", async () => {
    const app = await buildApp(root, vi.fn());
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/topic-experts/consult",
      payload: { selected: [], invokeType: "score" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("invalid invokeType returns 400", async () => {
    const app = await buildApp(root, vi.fn());
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/topic-experts/consult",
      payload: { selected: ["A"], invokeType: "invalid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("one expert fails → stream still emits all_done, 200", async () => {
    const invoke = vi.fn(async (a: any) => {
      if (a.name === "B") throw new Error("boom");
      return { markdown: "md", meta: { cli: "claude", durationMs: 1 } };
    });
    const app = await buildApp(root, invoke);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/p1/topic-experts/consult",
      payload: { selected: ["A", "B"], invokeType: "score", brief: "b", productContext: "pc" },
    });
    expect(res.statusCode).toBe(200);
    const events = parseSseEvents(res.payload);
    expect(events.find((e) => e.type === "expert_failed")).toBeTruthy();
    expect(events.at(-1)!.type).toBe("all_done");
  });
});
