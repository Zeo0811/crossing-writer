import type { FastifyInstance } from "fastify";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface KbStylePanelsDeps {
  vaultPath: string;
}

export interface StylePanelEntry {
  id: string;
  path: string;
  last_updated_at: string;
}

export function registerKbStylePanelsRoutes(app: FastifyInstance, deps: KbStylePanelsDeps) {
  app.get("/api/kb/style-panels", async (_req, reply) => {
    const dir = join(deps.vaultPath, "08_experts", "style-panel");
    if (!existsSync(dir)) return reply.send([]);
    const entries: StylePanelEntry[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      entries.push({
        id: name.slice(0, -3),
        path: abs,
        last_updated_at: st.mtime.toISOString(),
      });
    }
    entries.sort((a, b) => a.id.localeCompare(b.id));
    return reply.send(entries);
  });
}
