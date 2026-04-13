import type { FastifyInstance } from "fastify";
import type { ConfigStore, AgentConfigPatch } from "../services/config-store.js";

const VALID_CLI = new Set(["claude", "codex"]);

export interface ConfigRoutesDeps {
  configStore: ConfigStore;
}

export function registerConfigRoutes(app: FastifyInstance, deps: ConfigRoutesDeps) {
  app.get("/api/config/agents", async () => {
    const c = deps.configStore.current;
    return {
      defaultCli: c.defaultCli,
      fallbackCli: c.fallbackCli,
      agents: c.agents,
    };
  });

  app.patch<{ Body: AgentConfigPatch }>("/api/config/agents", async (req, reply) => {
    const body = req.body ?? {};
    if (body.defaultCli != null && !VALID_CLI.has(body.defaultCli)) {
      return reply.code(400).send({ error: `invalid defaultCli: ${body.defaultCli}` });
    }
    if (body.fallbackCli != null && !VALID_CLI.has(body.fallbackCli)) {
      return reply.code(400).send({ error: `invalid fallbackCli: ${body.fallbackCli}` });
    }
    if (body.agents) {
      for (const [k, v] of Object.entries(body.agents)) {
        if (!v || !VALID_CLI.has(v.cli)) {
          return reply.code(400).send({ error: `invalid cli for agent ${k}: ${v?.cli}` });
        }
      }
    }
    await deps.configStore.update(body);
    return reply.send({ ok: true });
  });
}
