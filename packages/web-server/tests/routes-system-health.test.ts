import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerSystemHealthRoutes } from "../src/routes/system-health.js";

function buildApp(prober: any) {
  const app = Fastify();
  registerSystemHealthRoutes(app, { prober });
  return app;
}

describe("GET /api/system/cli-health", () => {
  it("returns prober payload", async () => {
    const payload = {
      claude: { status: "online", version: "1.4.2", checkedAt: "2026-04-14T00:00:00.000Z" },
      codex: { status: "offline", error: "command not found", checkedAt: "2026-04-14T00:00:00.000Z" },
    };
    const app = buildApp({ probe: vi.fn().mockResolvedValue(payload) });
    const res = await app.inject({ method: "GET", url: "/api/system/cli-health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(payload);
    await app.close();
  });

  it("returns 500 when prober throws", async () => {
    const app = buildApp({ probe: vi.fn().mockRejectedValue(new Error("boom")) });
    const res = await app.inject({ method: "GET", url: "/api/system/cli-health" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ message: "boom" });
    await app.close();
  });
});
