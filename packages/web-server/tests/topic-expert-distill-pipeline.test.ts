import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { TopicExpertStore } from "../src/services/topic-expert-store.js";
import {
  runTopicExpertDistill,
  type DistillEvent,
} from "../src/services/topic-expert-distill.js";
import { registerTopicExpertsRoutes } from "../src/routes/topic-experts.js";

function seedVault(body = "prior") {
  const root = mkdtempSync(join(tmpdir(), "vault-dp-"));
  mkdirSync(join(root, "08_experts/topic-panel/experts"), { recursive: true });
  writeFileSync(
    join(root, "08_experts/topic-panel/experts/alice_kb.md"),
    `---\nname: alice\nspecialty: zen\n---\n${body}`,
    "utf-8",
  );
  return root;
}

describe("runTopicExpertDistill", () => {
  it("initial mode: no backup, emits started → ingest_progress × N → distill.done v1", async () => {
    const root = seedVault("");
    const store = new TopicExpertStore(root);
    const events: DistillEvent[] = [];
    const ingest = vi.fn(async (urls: string[], onP?: any) => {
      const articles = urls.map((u) => ({ url: u, title: `T-${u}`, body: "x" }));
      for (const a of articles) onP?.(a);
      return { articles };
    });
    const distill = vi.fn(async () => ({ markdown: "# new kb" }));
    const r = await runTopicExpertDistill(
      { expertName: "alice", seedUrls: ["u1", "u2"], mode: "initial" },
      { store, ingest, distill, emit: (e) => events.push(e) },
    );
    expect(r.version).toBe(1);
    expect(r.backupPath).toBeUndefined();
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("distill.started");
    expect(types.filter((t) => t === "ingest_progress")).toHaveLength(2);
    expect(types.at(-1)).toBe("distill.done");
  });

  it("redistill mode: backup returned; version increments", async () => {
    const root = seedVault("old kb content");
    const store = new TopicExpertStore(root);
    const events: DistillEvent[] = [];
    const ingest = vi.fn(async () => ({ articles: [] }));
    const distill = vi.fn(async () => ({ markdown: "# v2" }));
    const r = await runTopicExpertDistill(
      { expertName: "alice", seedUrls: [], mode: "redistill" },
      { store, ingest, distill, emit: (e) => events.push(e) },
    );
    expect(r.backupPath).toBeTruthy();
    expect(r.version).toBe(1);
  });

  it("ingest throws → distill.failed", async () => {
    const root = seedVault("body");
    const store = new TopicExpertStore(root);
    const events: DistillEvent[] = [];
    const ingest = vi.fn(async () => { throw new Error("net err"); });
    const distill = vi.fn();
    await expect(
      runTopicExpertDistill(
        { expertName: "alice", seedUrls: ["u"], mode: "initial" },
        { store, ingest, distill, emit: (e) => events.push(e) },
      ),
    ).rejects.toThrow(/net err/);
    expect(events.at(-1)!.type).toBe("distill.failed");
  });
});

describe("POST /api/topic-experts/:name/distill (SSE pipeline)", () => {
  it("emits SSE events in order on 2-url seed", async () => {
    const root = seedVault("old");
    const store = new TopicExpertStore(root);
    const ingest = vi.fn(async (urls: string[], onP?: any) => {
      const articles = urls.map((u) => ({ url: u, title: `T-${u}`, body: "x" }));
      for (const a of articles) onP?.(a);
      return { articles };
    });
    const distill = vi.fn(async () => ({ markdown: "# md" }));
    const app = Fastify();
    registerTopicExpertsRoutes(app, {
      store,
      distillDeps: { ingest, distill },
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/topic-experts/alice/distill",
      payload: { seed_urls: ["u1", "u2"], mode: "redistill" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatch(/event: distill\.started/);
    expect(res.payload).toMatch(/event: ingest_progress/);
    expect(res.payload).toMatch(/event: distill\.done/);
  });
});
