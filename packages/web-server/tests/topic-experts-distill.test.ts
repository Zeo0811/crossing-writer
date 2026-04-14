import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { TopicExpertStore } from "../src/services/topic-expert-store.js";
import { registerTopicExpertsRoutes } from "../src/routes/topic-experts.js";

function seedVault(withBody = true) {
  const root = mkdtempSync(join(tmpdir(), "vault-te-d-"));
  mkdirSync(join(root, "08_experts/topic-panel/experts"), { recursive: true });
  const body = withBody ? "prior body content" : "";
  writeFileSync(
    join(root, "08_experts/topic-panel/experts/alice_kb.md"),
    `---\nname: alice\nspecialty: zen\n---\n${body}`,
    "utf-8",
  );
  return root;
}

async function buildApp(root: string) {
  const store = new TopicExpertStore(root);
  const app = Fastify();
  registerTopicExpertsRoutes(app, { store });
  await app.ready();
  return { app, root };
}

describe("POST /api/topic-experts/:name/distill stub", () => {
  it("404 on unknown expert", async () => {
    const { app } = await buildApp(seedVault());
    const res = await app.inject({
      method: "POST",
      url: "/api/topic-experts/unknown/distill",
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("202 with job_id/status queued; .bak written when body non-empty and mode=redistill", async () => {
    const { app, root } = await buildApp(seedVault(true));
    const res = await app.inject({
      method: "POST",
      url: "/api/topic-experts/alice/distill",
      payload: { mode: "redistill" },
    });
    expect(res.statusCode).toBe(202);
    const j = res.json() as any;
    expect(j.status).toBe("queued");
    expect(typeof j.job_id).toBe("string");
    const bak = join(root, "08_experts/topic-panel/.bak");
    expect(existsSync(bak)).toBe(true);
    expect(readdirSync(bak).some((f) => f.startsWith("alice_kb."))).toBe(true);
  });

  it("initial mode skips backup even when KB has body", async () => {
    const { app, root } = await buildApp(seedVault(true));
    const res = await app.inject({
      method: "POST",
      url: "/api/topic-experts/alice/distill",
      payload: { mode: "initial" },
    });
    expect(res.statusCode).toBe(202);
    const bak = join(root, "08_experts/topic-panel/.bak");
    expect(existsSync(bak)).toBe(false);
  });

  it("redistill skips .bak when body empty", async () => {
    const { app, root } = await buildApp(seedVault(false));
    const res = await app.inject({
      method: "POST",
      url: "/api/topic-experts/alice/distill",
      payload: { mode: "redistill" },
    });
    expect(res.statusCode).toBe(202);
    const bak = join(root, "08_experts/topic-panel/.bak");
    expect(existsSync(bak)).toBe(false);
  });
});
