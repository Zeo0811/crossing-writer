import type { FastifyInstance } from "fastify";
import { readEvents } from "../services/event-log.js";
import { subscribe } from "../services/sse-broadcaster.js";
import { join } from "node:path";

export function registerStreamRoutes(
  app: FastifyInstance,
  deps: { projectsDir: string },
) {
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/stream",
    async (req, reply) => {
      const { id } = req.params;
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // replay based on Last-Event-ID
      const lastId = Number(req.headers["last-event-id"] ?? -1);
      const past = await readEvents(join(deps.projectsDir, id));
      past.forEach((e, idx) => {
        if (idx <= lastId) return;
        reply.raw.write(
          `id: ${idx}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`,
        );
      });

      let counter = past.length;
      const unsub = subscribe(id, (e) => {
        const thisId = counter++;
        reply.raw.write(
          `id: ${thisId}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`,
        );
      });

      req.raw.on("close", () => {
        unsub();
        reply.raw.end();
      });

      // keep connection open, fastify needs this return pattern
      return reply;
    },
  );
}
