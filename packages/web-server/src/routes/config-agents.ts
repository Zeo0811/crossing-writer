import type { FastifyInstance } from "fastify";
import type { AgentConfigEntry, AgentConfigStore } from "../services/agent-config-store.js";
import type { ConfigStore } from "../services/config-store.js";
import type { DefaultModelConfig } from "../config.js";

const VALID_CLI = new Set(["claude", "codex"]);

export interface ConfigAgentsDeps {
  agentConfigStore: AgentConfigStore;
  configStore: ConfigStore;
}

export function registerConfigAgentsRoutes(app: FastifyInstance, deps: ConfigAgentsDeps): void {
  app.get("/api/config/agents", async (_req, reply) => {
    const agents = deps.agentConfigStore.getAll();
    return reply.send({ agents, defaultModel: deps.configStore.current.defaultModel });
  });

  app.patch<{ Body: { defaultModel?: Partial<DefaultModelConfig> } }>(
    "/api/config/agents",
    async (req, reply) => {
      const body = req.body ?? {};
      if (body.defaultModel != null) {
        for (const tier of ["writer", "other"] as const) {
          const entry = body.defaultModel[tier];
          if (entry === undefined) continue;
          if (!entry || typeof entry !== "object") {
            return reply.code(400).send({ error: `defaultModel.${tier}.cli must be claude|codex` });
          }
          const cli = (entry as { cli?: unknown }).cli;
          if (typeof cli !== "string" || !VALID_CLI.has(cli)) {
            return reply.code(400).send({ error: `defaultModel.${tier}.cli must be claude|codex` });
          }
        }
        await deps.configStore.update({ defaultModel: body.defaultModel });
      }
      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: { agentKey: string } }>(
    "/api/config/agents/:agentKey",
    async (req, reply) => {
      const agentKey = decodeURIComponent(req.params.agentKey);
      const entry = deps.agentConfigStore.get(agentKey);
      if (!entry) {
        return reply.code(404).send({ error: `agent config not found: ${agentKey}` });
      }
      return reply.send(entry);
    },
  );

  app.put<{ Params: { agentKey: string }; Body: AgentConfigEntry }>(
    "/api/config/agents/:agentKey",
    async (req, reply) => {
      const agentKey = decodeURIComponent(req.params.agentKey);
      const body = req.body;
      if (!body || typeof body !== "object") {
        return reply.code(400).send({ error: "body required" });
      }
      if (body.agentKey && body.agentKey !== agentKey) {
        return reply
          .code(400)
          .send({ error: `agentKey mismatch: url=${agentKey} body=${body.agentKey}` });
      }
      const entry: AgentConfigEntry = { ...body, agentKey };
      try {
        await deps.agentConfigStore.set(agentKey, entry);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
      return reply.send({ ok: true, agent: entry });
    },
  );
}
