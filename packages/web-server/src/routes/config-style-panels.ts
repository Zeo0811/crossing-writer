import type { FastifyInstance } from "fastify";
import type { StylePanelStore } from "../services/style-panel-store.js";
import type { StylePanelRole } from "../services/style-panel-types.js";

export interface ConfigStylePanelsDeps {
  stylePanelStore: StylePanelStore;
}

const VALID_ROLES: StylePanelRole[] = ["opening", "practice", "closing", "legacy"];

export function registerConfigStylePanelsRoutes(
  app: FastifyInstance,
  deps: ConfigStylePanelsDeps,
): void {
  app.get<{
    Querystring: { account?: string; role?: string; include_deleted?: string };
  }>("/api/config/style-panels", async (req, reply) => {
    const { account, role, include_deleted } = req.query ?? {};
    const includeDeleted = include_deleted === "1" || include_deleted === "true";
    let panels = deps.stylePanelStore.list();
    if (account) panels = panels.filter((p) => p.frontmatter.account === account);
    if (role) panels = panels.filter((p) => p.frontmatter.role === role);
    if (!includeDeleted) panels = panels.filter((p) => p.frontmatter.status !== "deleted");
    const out = panels.map((p) => ({
      account: p.frontmatter.account,
      role: p.frontmatter.role,
      version: p.frontmatter.version,
      status: p.frontmatter.status,
      created_at: p.frontmatter.created_at,
      source_article_count: p.frontmatter.source_article_count,
      absPath: p.absPath,
      is_legacy: p.frontmatter.role === "legacy",
    }));
    return reply.send({ panels: out });
  });

  app.delete<{
    Params: { account: string; role: string; version: string };
    Querystring: { hard?: string };
  }>("/api/config/style-panels/:account/:role/:version", async (req, reply) => {
    const account = decodeURIComponent(req.params.account);
    const roleRaw = decodeURIComponent(req.params.role);
    if (!VALID_ROLES.includes(roleRaw as StylePanelRole)) {
      return reply.code(400).send({ error: `invalid role: ${roleRaw}` });
    }
    const role = roleRaw as StylePanelRole;
    const version = Number.parseInt(req.params.version, 10);
    if (!Number.isFinite(version)) {
      return reply.code(400).send({ error: `invalid version: ${req.params.version}` });
    }
    const hard = req.query?.hard === "1" || req.query?.hard === "true";
    const ok = hard
      ? deps.stylePanelStore.hardDelete(account, role, version)
      : deps.stylePanelStore.softDelete(account, role, version);
    if (!ok) {
      return reply
        .code(404)
        .send({ error: `style panel not found: ${account}/${role}/v${version}` });
    }
    return reply.send({ ok: true, hard });
  });
}
