import { readFileSync } from "node:fs";
import type { AgentStyleBinding } from "./agent-config-store.js";
import { StylePanelStore } from "./style-panel-store.js";
import { parsePanel, type StylePanel } from "./style-panel-types.js";
import type { ArticleType, PanelV2 } from "@crossing/kb";
import { parsePanelV2, extractTypeSection } from "@crossing/kb";

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

// ============================================================================
// V2 resolver (SP-A) — below
// ============================================================================

export class StyleVersionTooOldError extends Error {
  constructor(
    public binding: StyleBinding,
    public foundVersion: number,
  ) {
    super(
      `style binding version ${foundVersion} too old for ${binding.account}/${binding.role}, need >= 2`,
    );
    this.name = 'StyleVersionTooOldError';
  }
}

export class TypeNotInPanelError extends Error {
  constructor(
    public binding: StyleBinding,
    public articleType: string,
    public availableTypes: string[],
  ) {
    super(
      `panel ${binding.account}/${binding.role} has no "${articleType}" type; available: ${availableTypes.join(',') || '(none)'}`,
    );
    this.name = 'TypeNotInPanelError';
  }
}

export interface ResolvedStyleV2 {
  panel: PanelV2;
  typeSection: string;
}

/**
 * V2 resolver: requires panel.version === 2 AND the requested articleType has
 * sample_count > 0 in the panel's types list AND extractTypeSection finds the body section.
 *
 * Throws:
 * - StyleNotBoundError(missing) when no active panel exists for (account, role)
 * - StyleVersionTooOldError when the active panel is v1 (or anything < 2)
 * - TypeNotInPanelError when the articleType isn't in panel.types with sample_count > 0
 *   OR extractTypeSection returns null (section body absent)
 */
export async function resolveStyleBindingV2(
  binding: StyleBinding,
  articleType: ArticleType,
  store: StylePanelStore,
): Promise<ResolvedStyleV2> {
  const latest = store.getLatestActive(binding.account, binding.role);
  if (!latest) {
    throw new StyleNotBoundError(binding, 'missing');
  }
  const foundVersion = latest.frontmatter.version ?? 1;
  if (foundVersion !== 2) {
    throw new StyleVersionTooOldError(binding, foundVersion);
  }
  const raw = readFileSync(latest.absPath, 'utf-8');
  const panel = parsePanelV2(latest.absPath, raw);
  const typeEntry = panel.frontmatter.types.find(
    (t) => t.key === articleType && t.sample_count > 0,
  );
  if (!typeEntry) {
    throw new TypeNotInPanelError(
      binding,
      articleType,
      panel.frontmatter.types.map((t) => t.key),
    );
  }
  const section = extractTypeSection(panel.body, articleType);
  if (!section) {
    throw new TypeNotInPanelError(
      binding,
      articleType,
      panel.frontmatter.types.map((t) => t.key),
    );
  }
  return { panel, typeSection: section };
}
