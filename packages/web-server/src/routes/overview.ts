import type { FastifyInstance } from "fastify";
import "@fastify/multipart";
import type { ProjectStore } from "../services/project-store.js";
import type { ImageStore } from "../services/image-store.js";
import { analyzeOverview } from "../services/overview-analyzer-service.js";

export interface OverviewDeps {
  store: ProjectStore;
  imageStore: ImageStore;
  projectsDir: string;
  analyzeOverviewDeps: {
    vaultPath: string;
    sqlitePath: string;
    agents: Record<string, unknown>;
    defaultCli: "claude" | "codex";
    fallbackCli: "claude" | "codex";
  };
}

export function registerOverviewRoutes(app: FastifyInstance, deps: OverviewDeps) {
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/overview/images",
    async (req, reply) => {
      const { id } = req.params;
      const project = await deps.store.get(id);
      if (!project) return reply.code(404).send({ error: "project not found" });

      const parts = req.parts();
      let source: string | undefined;
      let label: string | undefined;
      let fileData: { filename: string; buffer: Buffer } | null = null;

      for await (const part of parts) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const c of part.file) chunks.push(c as Buffer);
          fileData = { filename: part.filename, buffer: Buffer.concat(chunks) };
        } else {
          const value = part.value;
          if (part.fieldname === "source") source = String(value);
          if (part.fieldname === "label") label = String(value);
        }
      }

      if (!fileData) return reply.code(400).send({ error: "no file" });
      if (source !== "brief" && source !== "screenshot") {
        return reply.code(400).send({ error: "source must be brief or screenshot" });
      }

      const info = await deps.imageStore.save({
        projectId: id,
        filename: fileData.filename,
        buffer: fileData.buffer,
        source,
        label,
      });
      return reply.code(201).send(info);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/overview/images",
    async (req) => deps.imageStore.list(req.params.id),
  );

  app.delete<{ Params: { id: string; filename: string } }>(
    "/api/projects/:id/overview/images/:filename",
    async (req, reply) => {
      await deps.imageStore.delete(req.params.id, req.params.filename);
      return reply.code(204).send();
    },
  );

  app.post<{
    Params: { id: string };
    Body: { productUrls?: string[]; userDescription?: string };
  }>("/api/projects/:id/overview/generate", async (req, reply) => {
    const { id } = req.params;
    const project = await deps.store.get(id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const images = await deps.imageStore.list(id);
    if (images.length === 0) {
      return reply.code(400).send({ error: "at least one image required" });
    }
    const body = req.body ?? {};
    void analyzeOverview({
      projectId: id,
      projectsDir: deps.projectsDir,
      store: deps.store,
      imageStore: deps.imageStore,
      productUrls: body.productUrls ?? [],
      userDescription: body.userDescription,
      ...deps.analyzeOverviewDeps,
    }).catch(() => { /* error is logged via events */ });
    return reply.code(202).send({ status: "analyzing" });
  });
}
