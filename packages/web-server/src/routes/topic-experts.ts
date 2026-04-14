import type { FastifyInstance } from "fastify";
import type { TopicExpertStore, TopicExpertMeta } from "../services/topic-expert-store.js";
import {
  runTopicExpertDistill,
  type DistillDeps,
  type DistillEvent,
} from "../services/topic-expert-distill.js";

export interface TopicExpertsRoutesOpts {
  store: TopicExpertStore;
  distillDeps?: Pick<DistillDeps, "ingest" | "distill">;
}

export function registerTopicExpertsRoutes(
  app: FastifyInstance,
  opts: TopicExpertsRoutesOpts,
) {
  const { store } = opts;

  app.get("/api/topic-experts", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const includeDeleted = q.include_deleted === "1" || q.include_deleted === "true";
    const all = await store.list();
    return { experts: includeDeleted ? all : all.filter((e) => !e.soft_deleted) };
  });

  app.get("/api/topic-experts/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const detail = await store.get(name);
    if (!detail) return reply.code(404).send({ error: "not_found" });
    return detail;
  });

  app.put("/api/topic-experts/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as {
      active?: boolean;
      default_preselect?: boolean;
      specialty?: string;
      kb_markdown?: string;
    };
    const patch: Partial<Pick<TopicExpertMeta, "active" | "default_preselect" | "specialty">> = {};
    if (body.active !== undefined) patch.active = body.active;
    if (body.default_preselect !== undefined) patch.default_preselect = body.default_preselect;
    if (body.specialty !== undefined) patch.specialty = body.specialty;
    let meta: TopicExpertMeta | undefined;
    try {
      if (Object.keys(patch).length > 0) {
        meta = await store.set(name, patch);
      } else {
        const list = await store.list();
        meta = list.find((e) => e.name === name);
        if (!meta) return reply.code(404).send({ error: "not_found" });
      }
      if (body.kb_markdown !== undefined) {
        await store.writeKb(name, body.kb_markdown);
      }
    } catch (e: any) {
      if (String(e?.message).includes("not found")) {
        return reply.code(404).send({ error: "not_found" });
      }
      throw e;
    }
    return { ok: true, expert: meta };
  });

  app.post("/api/topic-experts", async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; specialty?: string; seed_urls?: string[] };
    if (!body.name || !body.specialty) {
      return reply.code(400).send({ error: "missing_fields" });
    }
    try {
      const expert = await store.create(body.name, body.specialty);
      if (body.seed_urls && body.seed_urls.length) {
        console.info("[topic-expert] TODO distill pipeline", {
          name: body.name,
          urls: body.seed_urls,
        });
      }
      return { ok: true, expert, job_id: null };
    } catch (e: any) {
      if (/exists|duplicate/i.test(String(e?.message))) {
        return reply.code(409).send({ error: "duplicate" });
      }
      throw e;
    }
  });

  app.delete("/api/topic-experts/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const q = (req.query as Record<string, string>) ?? {};
    let mode: "soft" | "hard" = q.mode === "hard" ? "hard" : "soft";
    if (q.hard === "1" || q.hard === "true") mode = "hard";
    try {
      if (mode === "hard") await store.hardDelete(name);
      else await store.softDelete(name);
    } catch (e: any) {
      if (String(e?.message).includes("not found")) {
        return reply.code(404).send({ error: "not_found" });
      }
      throw e;
    }
    return { ok: true, mode };
  });

  app.post("/api/topic-experts/:name/distill", async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as { seed_urls?: string[]; mode?: "initial" | "redistill" };
    const detail = await store.get(name);
    if (!detail) return reply.code(404).send({ error: "not_found" });
    const mode = body.mode ?? "initial";

    if (!opts.distillDeps) {
      // fallback: stub behavior for environments without pipeline wiring
      if (mode === "redistill") await store.backupKb(name);
      return reply.code(202).send({ job_id: `stub-${Date.now()}`, status: "queued" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    (reply.raw as any).flushHeaders?.();
    const emit = (ev: DistillEvent) => {
      reply.raw.write(`event: ${ev.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(ev.data)}\n\n`);
    };
    try {
      await runTopicExpertDistill(
        {
          expertName: name,
          seedUrls: body.seed_urls,
          mode,
        },
        { store, ingest: opts.distillDeps.ingest, distill: opts.distillDeps.distill, emit },
      );
    } catch {
      // failed event already emitted by pipeline
    } finally {
      reply.raw.end();
    }
  });
}
