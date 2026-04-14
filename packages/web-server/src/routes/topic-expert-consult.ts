import type { FastifyInstance } from "fastify";
import type { TopicExpertStore } from "../services/topic-expert-store.js";
import {
  runTopicExpertConsult,
  type ConsultEvent,
} from "../services/topic-expert-consult.js";
import type { invokeTopicExpert as invokeTopicExpertType } from "@crossing/agents";

export interface TopicExpertConsultRoutesOpts {
  store: TopicExpertStore;
  invoke: typeof invokeTopicExpertType;
}

export function registerTopicExpertConsultRoutes(
  app: FastifyInstance,
  opts: TopicExpertConsultRoutesOpts,
) {
  app.post("/api/projects/:id/topic-experts/consult", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      selected?: string[];
      invokeType?: string;
      brief?: string;
      productContext?: string;
      candidatesMd?: string;
      currentDraft?: string;
      focus?: string;
    };
    if (!Array.isArray(body.selected) || body.selected.length === 0) {
      return reply.code(400).send({ error: "selected_empty" });
    }
    const validTypes = ["score", "structure", "continue"];
    if (!body.invokeType || !validTypes.includes(body.invokeType)) {
      return reply.code(400).send({ error: "invalid_invokeType" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    (reply.raw as any).flushHeaders?.();

    const emit = (ev: ConsultEvent) => {
      reply.raw.write(`event: ${ev.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(ev.data)}\n\n`);
    };

    try {
      await runTopicExpertConsult(
        {
          projectId: id,
          selectedExperts: body.selected,
          invokeType: body.invokeType as any,
          brief: body.brief,
          productContext: body.productContext,
          candidatesMd: body.candidatesMd,
          currentDraft: body.currentDraft,
          focus: body.focus,
        },
        { store: opts.store, invoke: opts.invoke, emit },
      );
    } catch (err: any) {
      emit({ type: "expert_failed", data: { name: "*", error: String(err?.message ?? err) } });
      emit({ type: "all_done", data: { succeeded: [], failed: body.selected } });
    } finally {
      reply.raw.end();
    }
  });
}
