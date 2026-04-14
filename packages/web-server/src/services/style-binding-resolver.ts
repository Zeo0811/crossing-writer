import { readFileSync } from "node:fs";
import type { AgentStyleBinding } from "./agent-config-store.js";
import { StylePanelStore } from "./style-panel-store.js";
import { parsePanel, type StylePanel } from "./style-panel-types.js";

export type StyleBinding = AgentStyleBinding;

export type StyleNotBoundReason = "missing" | "deleted_only" | "legacy_only";

export class StyleNotBoundError extends Error {
  constructor(
    public binding: StyleBinding,
    public reason: StyleNotBoundReason,
  ) {
    super(
      `style binding not resolvable for account=${binding.account} role=${binding.role}: ${reason}`,
    );
    this.name = "StyleNotBoundError";
  }
}

/**
 * Resolve an agent's style binding to an active StylePanel and its body content.
 *
 * - `binding` undefined → returns null (agent has no binding configured).
 * - Active panel found → reads file from disk, strips frontmatter, returns `{ panel, bodyContent }`.
 * - No active match → throws `StyleNotBoundError` with a detailed reason:
 *   - `"deleted_only"`: panels exist for `(account, role)` but all are soft-deleted.
 *   - `"legacy_only"`: no `(account, role)` panels at all, but the account has legacy panels.
 *   - `"missing"`: nothing exists for that account.
 */
export async function resolveStyleBinding(
  binding: StyleBinding | undefined,
  store: StylePanelStore,
): Promise<{ panel: StylePanel; bodyContent: string } | null> {
  if (!binding) return null;

  const active = store.getLatestActive(binding.account, binding.role);
  if (active) {
    const raw = readFileSync(active.absPath, "utf-8");
    const parsed = parsePanel(active.absPath, raw);
    return { panel: active, bodyContent: parsed.body };
  }

  const all = store.list();
  const sameAccountRole = all.filter(
    (p) => p.frontmatter.account === binding.account && p.frontmatter.role === binding.role,
  );
  if (sameAccountRole.length > 0) {
    // every matching panel must be deleted (otherwise getLatestActive would have returned one)
    throw new StyleNotBoundError(binding, "deleted_only");
  }

  const sameAccount = all.filter((p) => p.frontmatter.account === binding.account);
  if (sameAccount.length > 0 && sameAccount.every((p) => p.frontmatter.role === "legacy")) {
    throw new StyleNotBoundError(binding, "legacy_only");
  }

  throw new StyleNotBoundError(binding, "missing");
}
