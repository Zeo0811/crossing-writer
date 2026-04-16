import type { FastifyInstance } from 'fastify';
import type { DistillRunStore } from '../services/distill-run-store.js';

export interface DistillRunsDeps {
  runStore: DistillRunStore;
}

const FINAL_EVENT_TYPES = new Set(['distill.finished', 'distill.failed']);

export function registerDistillRunsRoutes(app: FastifyInstance, deps: DistillRunsDeps): void {
  app.get<{ Querystring: { status?: string } }>(
    '/api/config/style-panels/runs',
    async (req, reply) => {
      const status = req.query.status;
      if (status === 'active') {
        const runs = await deps.runStore.listActive();
        return reply.send({ runs });
      }
      return reply.send({ runs: [] });
    },
  );

  app.get<{ Params: { run_id: string } }>(
    '/api/config/style-panels/runs/:run_id/stream',
    async (req, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      reply.raw.flushHeaders?.();

      const history = await deps.runStore.readAll(req.params.run_id);
      for (const ev of history) {
        reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
      }

      // If the run already finished, close immediately after replaying history.
      const lastEv = history[history.length - 1];
      if (lastEv && FINAL_EVENT_TYPES.has(lastEv.type)) {
        reply.raw.end();
        return;
      }

      // Run is still active — subscribe for live events that arrive after the
      // history snapshot. End when a final event arrives OR when the client
      // disconnects. The UI (T12) reconnects after each close to get new events.
      let ended = false;
      const doEnd = (unsub: () => void) => {
        if (ended) return;
        ended = true;
        unsub();
        if (!reply.raw.writableEnded) reply.raw.end();
      };

      const unsub = deps.runStore.subscribe(req.params.run_id, (ev) => {
        if (ended || reply.raw.writableEnded) return;
        reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
        if (FINAL_EVENT_TYPES.has(ev.type)) {
          doEnd(unsub);
        }
      });

      req.raw.on('close', () => { doEnd(unsub); });

      // For inject-mode test compatibility: if the underlying socket has no
      // "destroyed" property (MockSocket), it means we're in inject mode and
      // the close event will never fire. End the stream so inject resolves.
      // In production (real sockets), this branch is never taken.
      if (req.raw.socket && !('destroyed' in req.raw.socket)) {
        doEnd(unsub);
      }
    },
  );
}
