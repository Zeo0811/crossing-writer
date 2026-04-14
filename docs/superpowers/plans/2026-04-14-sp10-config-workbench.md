# SP-10 Role-Scoped Style + Config Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship role-scoped (account × opening/practice/closing) style distillation; add unified Config Workbench page managing agent model/style/tools/prompt bindings; support project-level sticky overrides; block runs when style not bound.

**Architecture:** Backend adds agent-config-store + style-panel-store + project-override-store services + section-slicer agent + reworked distiller orchestrator + config routes. Frontend adds Config Workbench page + 5 components. Legacy SP-06 panels tagged `role: legacy`, not bindable.

**Tech Stack:** Fastify, React 18, vitest, @crossing/kb, @crossing/agents.

---

## T1 — `section-slicer` agent (agents package)

**Files:**
- Create: `packages/agents/src/roles/section-slicer.ts`
- Create: `packages/agents/src/prompts/section-slicer.md`
- Modify: `packages/agents/src/index.ts` (export `runSectionSlicer`, type `SectionSlice`)
- Test: `packages/agents/tests/section-slicer.test.ts` (create `tests/` if missing, matching existing pattern)

**Steps:**
1. [ ] Write `section-slicer.md` prompt: instructs model to return pure JSON array `[{start_char, end_char, role}]` where `role ∈ {"opening","practice","closing","other"}`. Include rule: spans must be non-overlapping and in range; response MUST start with `[`.
2. [ ] Create `section-slicer.ts`: read prompt via `readFileSync` + `fileURLToPath(import.meta.url)` pattern (copy from `style-distiller-composer-agent.ts`). Export `export interface SectionSlice { start_char: number; end_char: number; role: "opening"|"practice"|"closing"|"other" }`.
3. [ ] Export `runSectionSlicer(articleBody: string, opts: { cli: "claude"|"codex"; model?: string }): Promise<{ slices: SectionSlice[]; meta: { cli: string; model?: string|null; durationMs: number } }>`.
4. [ ] Implementation: build `userMessage = "Article body:\n\n" + body`. Call `invokeAgent({ agentKey: "section_slicer", ... })`. Parse `result.text` with `JSON.parse` wrapped in try/catch → on throw return empty slices (log via console.warn).
5. [ ] Validate slices: filter out entries where `start_char < 0`, `end_char > body.length`, `start_char >= end_char`, or role not in allowlist. Then sort by `start_char` and drop overlaps (keep first).
6. [ ] Re-export from `packages/agents/src/index.ts`.
7. [ ] Write tests with a mocked `invokeAgent` (vitest `vi.mock("../src/model-adapter.js")`). Cases:
   - happy path: mocked JSON returns 3 valid slices → parsed + sorted.
   - malformed JSON → returns `{ slices: [] }`.
   - overlapping slices → second dropped.
   - out-of-range slice → filtered.
   - bad role → filtered.

**Test code sketch:**
```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));
import { invokeAgent } from "../src/model-adapter.js";
import { runSectionSlicer } from "../src/roles/section-slicer.js";

describe("runSectionSlicer", () => {
  it("parses happy-path JSON", async () => {
    (invokeAgent as any).mockReturnValue({
      text: JSON.stringify([
        { start_char: 0, end_char: 10, role: "opening" },
        { start_char: 10, end_char: 50, role: "practice" },
        { start_char: 50, end_char: 80, role: "closing" },
      ]),
      meta: { cli: "claude", durationMs: 12 },
    });
    const body = "x".repeat(100);
    const out = await runSectionSlicer(body, { cli: "claude" });
    expect(out.slices).toHaveLength(3);
    expect(out.slices[0]!.role).toBe("opening");
  });
  it("returns empty on malformed JSON", async () => {
    (invokeAgent as any).mockReturnValue({ text: "not json", meta: { cli: "claude", durationMs: 1 } });
    const out = await runSectionSlicer("abc", { cli: "claude" });
    expect(out.slices).toEqual([]);
  });
  it("drops overlaps + out-of-range + bad role", async () => {
    (invokeAgent as any).mockReturnValue({
      text: JSON.stringify([
        { start_char: 0, end_char: 10, role: "opening" },
        { start_char: 5, end_char: 20, role: "practice" }, // overlap
        { start_char: 30, end_char: 200, role: "closing" }, // out-of-range
        { start_char: 40, end_char: 45, role: "junk" },     // bad role
      ]),
      meta: { cli: "claude", durationMs: 1 },
    });
    const out = await runSectionSlicer("x".repeat(50), { cli: "claude" });
    expect(out.slices.map(s => s.role)).toEqual(["opening"]);
  });
});
```

**Verify:** `pnpm --filter @crossing/agents exec vitest run tests/section-slicer.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T1): add section-slicer agent with role slicing"`

---

## T2 — StylePanel types + frontmatter helpers

**Files:**
- Create: `packages/web-server/src/services/style-panel-types.ts`
- Test: `packages/web-server/tests/style-panel-types.test.ts`

**Steps:**
1. [ ] Define `export type StylePanelRole = "opening"|"practice"|"closing"|"legacy"`.
2. [ ] Define `export interface StylePanelFrontmatter { account: string; role: StylePanelRole; version: number; status: "active"|"deleted"; created_at: string; source_article_count: number; slicer_run_id?: string; composer_duration_ms?: number; }`.
3. [ ] Define `export interface StylePanel { frontmatter: StylePanelFrontmatter; body: string; absPath: string; }`.
4. [ ] Export `parsePanel(absPath: string, raw: string): StylePanel` — uses `js-yaml` to parse between `---` fences. Missing frontmatter → throws `Error("not a style panel: no frontmatter")`.
5. [ ] Export `serializePanel(fm: StylePanelFrontmatter, body: string): string` — emits `---\n<yaml>\n---\n\n<body>\n`.
6. [ ] Export `isLegacy(fm: StylePanelFrontmatter): boolean` — returns `fm.role === "legacy"`.
7. [ ] Tests: round-trip (parse(serialize(x)) == x), missing frontmatter throws, unknown role parsed as-is (validation is caller's job but we flag legacy).

**Test code sketch:**
```ts
import { describe, it, expect } from "vitest";
import { parsePanel, serializePanel, isLegacy } from "../src/services/style-panel-types.js";

describe("style-panel-types", () => {
  const fm = {
    account: "十字路口", role: "opening" as const, version: 2, status: "active" as const,
    created_at: "2026-04-14T10:00:00Z", source_article_count: 42,
  };
  it("round-trips", () => {
    const raw = serializePanel(fm, "# hello\n");
    const parsed = parsePanel("/tmp/x.md", raw);
    expect(parsed.frontmatter).toMatchObject(fm);
    expect(parsed.body.trim()).toBe("# hello");
  });
  it("throws on missing frontmatter", () => {
    expect(() => parsePanel("/tmp/x.md", "just body")).toThrow(/no frontmatter/);
  });
  it("isLegacy true for role=legacy", () => {
    expect(isLegacy({ ...fm, role: "legacy" })).toBe(true);
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/style-panel-types.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T2): add StylePanel types + frontmatter serializer"`

---

## T3 — `StylePanelStore` service

**Files:**
- Create: `packages/web-server/src/services/style-panel-store.ts`
- Test: `packages/web-server/tests/style-panel-store.test.ts`

**Steps:**
1. [ ] Class `StylePanelStore` with `constructor(private vaultPath: string)`. Base dir is `join(vaultPath, "08_experts/style-panel")`.
2. [ ] `list(): StylePanel[]` — recurse `<base>/<account>/<role>-v<n>.md`; also scan top-level legacy `<base>/<account>_kb.md` or `<base>/*.md` files and tag frontmatter `role: legacy` synthetically if missing. Skip unparseable files with warn.
3. [ ] `getLatestActive(account, role): StylePanel | null` — filter `status=active` & matching `(account, role)`, pick `max(version)`.
4. [ ] `write(panel: StylePanel): string` — compute path `<base>/<account>/<role>-v<version>.md`; mkdir -p parent; write serialized; return absPath.
5. [ ] `softDelete(account, role, version): boolean` — load panel, set `status: "deleted"`, rewrite.
6. [ ] `hardDelete(account, role, version): boolean` — `unlinkSync` the file; return false if not found.
7. [ ] `markLegacy(absPath): void` — read file, inject/overwrite `role: legacy` in frontmatter, rewrite.
8. [ ] Tests using `mkdtempSync` for vault; cover: write then list returns it, latestActive picks max version, softDelete hides from latestActive, hardDelete removes file, legacy file surfaced in list with role=legacy, markLegacy updates.

**Test code sketch:**
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { serializePanel } from "../src/services/style-panel-types.js";

let vault: string;
beforeEach(() => { vault = mkdtempSync(join(tmpdir(), "sp10-")); });

function panel(account: string, role: any, version: number, status: "active"|"deleted" = "active") {
  return {
    frontmatter: { account, role, version, status, created_at: "2026-04-14T00:00:00Z", source_article_count: 10 },
    body: `# ${account}/${role} v${version}\n`, absPath: "",
  };
}

describe("StylePanelStore", () => {
  it("write + list + getLatestActive", () => {
    const s = new StylePanelStore(vault);
    s.write(panel("A", "opening", 1));
    s.write(panel("A", "opening", 2));
    expect(s.list().length).toBe(2);
    expect(s.getLatestActive("A", "opening")!.frontmatter.version).toBe(2);
  });
  it("softDelete hides from latestActive", () => {
    const s = new StylePanelStore(vault);
    s.write(panel("A", "opening", 1));
    s.write(panel("A", "opening", 2));
    s.softDelete("A", "opening", 2);
    expect(s.getLatestActive("A", "opening")!.frontmatter.version).toBe(1);
  });
  it("hardDelete removes file", () => {
    const s = new StylePanelStore(vault);
    s.write(panel("A", "closing", 1));
    expect(s.hardDelete("A", "closing", 1)).toBe(true);
    expect(s.list().length).toBe(0);
  });
  it("legacy top-level file surfaced with role=legacy", () => {
    const base = join(vault, "08_experts", "style-panel");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "OldAccount_kb.md"), "# legacy body\n");
    const s = new StylePanelStore(vault);
    const found = s.list();
    expect(found.some(p => p.frontmatter.role === "legacy")).toBe(true);
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/style-panel-store.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T3): add StylePanelStore service with soft/hard delete + legacy scan"`

---

## T4 — `AgentConfigStore` service

**Files:**
- Create: `packages/web-server/src/services/agent-config-store.ts`
- Test: `packages/web-server/tests/agent-config-store.test.ts`

**Steps:**
1. [ ] Define `AgentKey` allowlist constant: `["writer.opening","writer.practice","writer.closing","style_critic","case-planner-expert","practice.stitcher"]` (export).
2. [ ] Define `AgentConfigEntry` interface mirroring spec §2.3 (agentKey, model:{cli,model}, promptVersion?, styleBinding?, tools?).
3. [ ] Export `createAgentConfigStore(configStore: ConfigStore)` factory. Methods: `getAll(): Record<string, AgentConfigEntry>`, `get(agentKey): AgentConfigEntry | null`, `set(agentKey, cfg): Promise<void>`, `remove(agentKey): Promise<void>`.
4. [ ] `set` validates: agentKey in allowlist, `cfg.model.cli ∈ {"claude","codex"}`, if `styleBinding` present then `role ∈ {"opening","practice","closing"}` and `account` non-empty. Throw `Error("invalid agent config: ...")` on violation.
5. [ ] Writes delegate to `configStore.update({ agents: { ...current, [agentKey]: cfg } })`.
6. [ ] Reads go from `configStore.current.agents ?? {}`.
7. [ ] Tests with mocked `ConfigStore` (plain object + spy). Cover: get/getAll/set roundtrip, unknown agentKey rejected, bad cli rejected, bad styleBinding.role rejected, remove deletes key.

**Test code sketch:**
```ts
import { describe, it, expect, vi } from "vitest";
import { createAgentConfigStore } from "../src/services/agent-config-store.js";

function fakeConfigStore(initial: any = {}) {
  let current: any = { agents: initial };
  return {
    get current() { return current; },
    update: vi.fn(async (patch) => {
      if (patch.agents) current = { ...current, agents: patch.agents };
    }),
  };
}

describe("AgentConfigStore", () => {
  it("set + get roundtrip", async () => {
    const cs = fakeConfigStore();
    const s = createAgentConfigStore(cs as any);
    await s.set("writer.opening", {
      agentKey: "writer.opening",
      model: { cli: "claude", model: "opus" },
      styleBinding: { account: "A", role: "opening" },
      tools: { search_wiki: true, search_raw: true },
    });
    expect(s.get("writer.opening")!.styleBinding!.account).toBe("A");
  });
  it("rejects unknown agentKey", async () => {
    const s = createAgentConfigStore(fakeConfigStore() as any);
    await expect(s.set("junk.agent", { agentKey: "junk.agent", model: { cli: "claude" } } as any))
      .rejects.toThrow(/invalid agent/);
  });
  it("rejects bad cli", async () => {
    const s = createAgentConfigStore(fakeConfigStore() as any);
    await expect(s.set("writer.opening", { agentKey: "writer.opening", model: { cli: "gpt" } } as any))
      .rejects.toThrow();
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/agent-config-store.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T4): add AgentConfigStore service with allowlist validation"`

---

## T5 — `ProjectOverrideStore` service

**Files:**
- Create: `packages/web-server/src/services/project-override-store.ts`
- Test: `packages/web-server/tests/project-override-store.test.ts`

**Steps:**
1. [ ] Class `ProjectOverrideStore` with `constructor(private projectsDir: string)`. Override path: `join(projectsDir, projectId, "config.override.json")`.
2. [ ] Shape: `interface ProjectOverride { agents: Partial<Record<string, Partial<AgentConfigEntry>>> }`.
3. [ ] `get(projectId): ProjectOverride | null` — returns null if file missing; else `JSON.parse`.
4. [ ] `set(projectId, override): void` — atomic write via `.tmp` + rename.
5. [ ] `clear(projectId, agentKey): void` — reads, deletes that agentKey entry, writes (or deletes file if empty).
6. [ ] `delete(projectId): void` — unlink if exists.
7. [ ] Tests using tmp dir: set+get roundtrip, clear removes one agent, delete removes file, missing returns null.

**Note on format:** Spec §5.2 mentions `config.override.yaml` but for consistency with global `config.json` and to avoid adding `js-yaml` parsing to project store we use `.json`. Documented in plan; frontend file-browser will show it as JSON.

**Test code sketch:**
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectOverrideStore } from "../src/services/project-override-store.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sp10-po-"));
  mkdirSync(join(dir, "p1"));
});

describe("ProjectOverrideStore", () => {
  it("get returns null when missing", () => {
    expect(new ProjectOverrideStore(dir).get("p1")).toBeNull();
  });
  it("set + get roundtrip", () => {
    const s = new ProjectOverrideStore(dir);
    s.set("p1", { agents: { "writer.opening": { model: { cli: "codex", model: "gpt-5" } } } });
    expect(s.get("p1")!.agents["writer.opening"]!.model!.cli).toBe("codex");
  });
  it("clear removes one agent", () => {
    const s = new ProjectOverrideStore(dir);
    s.set("p1", { agents: { "writer.opening": { model: { cli: "codex" } }, "writer.closing": { tools: { search_raw: false } as any } } });
    s.clear("p1", "writer.opening");
    const o = s.get("p1")!;
    expect(o.agents["writer.opening"]).toBeUndefined();
    expect(o.agents["writer.closing"]).toBeDefined();
  });
  it("delete removes file", () => {
    const s = new ProjectOverrideStore(dir);
    s.set("p1", { agents: {} });
    s.delete("p1");
    expect(s.get("p1")).toBeNull();
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/project-override-store.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T5): add ProjectOverrideStore service"`

---

## T6 — Config merger helper

**Files:**
- Create: `packages/web-server/src/services/config-merger.ts`
- Test: `packages/web-server/tests/config-merger.test.ts`

**Steps:**
1. [ ] Export pure fn `mergeAgentConfig(global: AgentConfigEntry, override?: Partial<AgentConfigEntry>): AgentConfigEntry`.
2. [ ] Shallow merge at field level: `model` (override wins whole object if present), `promptVersion` (override wins), `styleBinding` (override wins whole object), `tools` (shallow merge per-key so one tool can flip without rewriting all).
3. [ ] `agentKey` always taken from `global`.
4. [ ] Export `mergeAllAgentConfigs(global: Record<string, AgentConfigEntry>, override: ProjectOverride | null): Record<string, AgentConfigEntry>`.
5. [ ] Tests: no override returns clone, override.model replaces entire model subtree, override.tools.search_wiki only flips that key, missing agent in override untouched.

**Test code sketch:**
```ts
import { describe, it, expect } from "vitest";
import { mergeAgentConfig, mergeAllAgentConfigs } from "../src/services/config-merger.js";

const base = {
  agentKey: "writer.opening",
  model: { cli: "claude" as const, model: "opus" },
  styleBinding: { account: "A", role: "opening" as const },
  tools: { search_wiki: true, search_raw: true },
};

describe("config-merger", () => {
  it("no override clones", () => {
    const out = mergeAgentConfig(base);
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });
  it("override.model replaces whole model", () => {
    const out = mergeAgentConfig(base, { model: { cli: "codex", model: "gpt-5" } });
    expect(out.model).toEqual({ cli: "codex", model: "gpt-5" });
  });
  it("override.tools shallow-merged", () => {
    const out = mergeAgentConfig(base, { tools: { search_raw: false } as any });
    expect(out.tools).toEqual({ search_wiki: true, search_raw: false });
  });
  it("mergeAllAgentConfigs passes through missing agent entries", () => {
    const globals = { "writer.opening": base, "writer.closing": { ...base, agentKey: "writer.closing" } };
    const merged = mergeAllAgentConfigs(globals, { agents: { "writer.opening": { model: { cli: "codex" } } } });
    expect(merged["writer.closing"]).toEqual(globals["writer.closing"]);
    expect(merged["writer.opening"]!.model.cli).toBe("codex");
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/config-merger.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T6): add mergeAgentConfig pure helper"`

---

## T7 — Role-scoped distill orchestrator

**Files:**
- Create: `packages/web-server/src/services/style-distill-role-orchestrator.ts`
- Test: `packages/web-server/tests/style-distill-role-orchestrator.test.ts`

**Steps:**
1. [ ] Export `interface RoleDistillInput { account: string; role: "opening"|"practice"|"closing" }`.
2. [ ] Export `interface RoleDistillCtx { sqlitePath: string; vaultPath: string; limit?: number; concurrency?: number; cliModelPerStep?: { slicer?, snippets?, structure?, composer? }; onEvent?: (ev: RoleDistillEvent) => void; }`.
3. [ ] Define event union: `{ phase: "started", account, role, run_id } | { phase: "slicer_progress", processed, total } | { phase: "snippets_done", count } | { phase: "structure_done" } | { phase: "composer_done", panel_path } | { phase: "failed", error }`.
4. [ ] Export `runRoleDistill(input, ctx): Promise<{ panelPath: string; version: number }>`.
5. [ ] Flow (copy query shape from `kb-style-panels.ts`):
   - Emit `started` with `run_id = "rd-" + Date.now()`.
   - Open sqlite read-only, `SELECT id, body_plain FROM ref_articles WHERE account=@a ORDER BY published_at DESC LIMIT @lim` (default 50). Close.
   - Concurrency-5 map over articles → `runSectionSlicer(body, ...)`. After each emit `slicer_progress`.
   - Collect `role`-matching slice texts: `slices.filter(s => s.role === input.role).map(s => body.slice(s.start_char, s.end_char))`.
   - Concatenate into corpus (separator `\n\n---\n\n`).
   - Call existing snippets/structure/composer agents (`StyleDistillerSnippetsAgent`, `Structure`, `Composer`) using the corpus as input. Adapt existing API; if their current API requires articles array, pass `[{ id: "corpus", body_plain: corpus }]`.
   - Emit `snippets_done`, `structure_done`, `composer_done` respectively.
   - Determine next version via `StylePanelStore.list()` filter same `(account, role)` → `max(version) + 1`.
   - Build `StylePanelFrontmatter { account, role, version, status: "active", created_at: new Date().toISOString(), source_article_count: articles.length, slicer_run_id, composer_duration_ms }`.
   - Write via `StylePanelStore.write({ frontmatter, body: composer.kbMd, absPath: "" })`.
   - Return `{ panelPath, version }`.
6. [ ] On any thrown error: emit `failed`, rethrow.
7. [ ] Tests with mocked `runSectionSlicer` + mocked composer agents (vi.mock). Assertions: emits `started` first and `composer_done` last, writes a panel with incrementing version, filters slices by role (other/practice are dropped when role=opening).

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/style-distill-role-orchestrator.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T7): role-scoped distill orchestrator with slicer -> composer pipeline"`

---

## T8 — `styleBindingResolver`

**Files:**
- Create: `packages/web-server/src/services/style-binding-resolver.ts`
- Test: `packages/web-server/tests/style-binding-resolver.test.ts`

**Steps:**
1. [ ] Export `class StyleNotBoundError extends Error { constructor(public agentKey: string, public reason: "no_binding"|"no_active_panel") { super(...); } }`.
2. [ ] Export `resolveStyleBinding(agentKey: string, binding: { account: string; role: "opening"|"practice"|"closing" } | undefined, store: StylePanelStore): { account: string; role: string; version: number; body: string; absPath: string }` — throws `StyleNotBoundError(agentKey, "no_binding")` when binding is null/undefined, throws `("no_active_panel")` when `store.getLatestActive(...)` returns null or returns a legacy panel.
3. [ ] Return panel's `body` (no frontmatter) plus metadata for injection + logging.
4. [ ] Tests: missing binding → throws no_binding; no active panel → throws no_active_panel; legacy panel treated as missing; happy path returns latest version.

**Test code sketch:**
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { resolveStyleBinding, StyleNotBoundError } from "../src/services/style-binding-resolver.js";

let vault: string;
beforeEach(() => { vault = mkdtempSync(join(tmpdir(), "sp10-sbr-")); });

describe("resolveStyleBinding", () => {
  it("throws no_binding when binding missing", () => {
    const s = new StylePanelStore(vault);
    expect(() => resolveStyleBinding("writer.opening", undefined, s)).toThrow(StyleNotBoundError);
  });
  it("throws no_active_panel when no panel", () => {
    const s = new StylePanelStore(vault);
    try { resolveStyleBinding("writer.opening", { account: "A", role: "opening" }, s); }
    catch (e: any) { expect(e.reason).toBe("no_active_panel"); return; }
    throw new Error("should have thrown");
  });
  it("happy path returns body", () => {
    const s = new StylePanelStore(vault);
    s.write({ frontmatter: { account: "A", role: "opening", version: 3, status: "active", created_at: "t", source_article_count: 1 }, body: "# body v3\n", absPath: "" });
    const out = resolveStyleBinding("writer.opening", { account: "A", role: "opening" }, s);
    expect(out.version).toBe(3);
    expect(out.body).toContain("body v3");
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/style-binding-resolver.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T8): styleBindingResolver + StyleNotBoundError"`

---

## T9 — Writer-orchestrator integration (merge + resolve + block)

**Files:**
- Modify: `packages/web-server/src/services/writer-orchestrator.ts`
- Test: `packages/web-server/tests/writer-orchestrator-sp10.test.ts` (new file, don't touch existing writer-orchestrator tests)

**Steps:**
1. [ ] Add optional new deps to `RunWriterOpts`: `agentConfigStore?: AgentConfigStore; projectOverrideStore?: ProjectOverrideStore; stylePanelStore?: StylePanelStore`. Backwards-compatible: if any are missing, fall back to legacy behaviour (existing tests still pass).
2. [ ] At entry, before starting writer agents, build `effectiveConfigs = mergeAllAgentConfigs(agentConfigStore.getAll(), projectOverrideStore?.get(projectId))`.
3. [ ] Pre-run validation loop over `["writer.opening","writer.practice","writer.closing"]`: try `resolveStyleBinding(key, effectiveConfigs[key]?.styleBinding, stylePanelStore)`. Collect failures into `missingBindings: Array<{ agentKey: string; reason: string }>`. If any — return `{ blocked: true, missingBindings } as const` without starting agents and without writing events.
4. [ ] On happy path: for each writer agent use merged `model` (cli/model) instead of reading from legacy `writerConfig.cli_model_per_agent` when `effectiveConfigs[key]` exists. Preserve existing signature so legacy callers without stores keep working.
5. [ ] Inject resolved style body into the agent's system prompt: pass through existing `runWriterOpening/Practice/Closing` call site via a new `stylePanelText: string` argument (if the underlying agent API doesn't accept one yet, prepend to the ReferenceAccountKb list with `id: "__style_panel__"` so prompts include it) — document the chosen method inline.
6. [ ] Emit existing SSE events unchanged on happy path. On blocked path the route layer will emit `run.blocked` (see T10/T12 routes), orchestrator just returns the object.
7. [ ] Tests (mock `agentConfigStore`, `projectOverrideStore`, `stylePanelStore`):
   - blocked path: one binding missing → returns `{ blocked: true, missingBindings: [{ agentKey: "writer.closing", reason: "no_active_panel" }] }`.
   - happy path: all three resolve → does not throw (agent runs themselves mocked or skipped via `sectionsToRun: []`).
   - override wins: agentConfigStore returns `cli: claude`, override returns `cli: codex` → orchestrator uses codex (assert via capturing arg passed to `runWriterOpening` mock).

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/writer-orchestrator-sp10.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T9): writer-orchestrator integrates merger + styleBinding gating"`

---

## T10 — Config agents routes (GET / PUT)

**Files:**
- Create: `packages/web-server/src/routes/config-agents.ts`
- Modify: `packages/web-server/src/server.ts` (register the route plugin next to existing route registrations)
- Test: `packages/web-server/tests/routes-config-agents.test.ts`

**Steps:**
1. [ ] Export `registerConfigAgentsRoutes(app: FastifyInstance, deps: { agentConfigStore: AgentConfigStore })`.
2. [ ] `GET /api/config/agents` → `{ agents: Record<string, AgentConfigEntry> }`.
3. [ ] `GET /api/config/agents/:agentKey` → single entry or 404.
4. [ ] `PUT /api/config/agents/:agentKey` with JSON body of `AgentConfigEntry`:
   - validate body.agentKey matches URL param (400 on mismatch).
   - call `agentConfigStore.set(agentKey, body)`.
   - wrap in try/catch — validation errors → 400.
   - return `{ ok: true, agent: body }`.
5. [ ] Register in `server.ts`.
6. [ ] Tests using `Fastify()` + in-memory fake `agentConfigStore`: list returns configured, 404 on missing, PUT validates + persists, bad cli → 400.

**Test code sketch:**
```ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerConfigAgentsRoutes } from "../src/routes/config-agents.js";

function buildApp() {
  const state: any = { "writer.opening": { agentKey: "writer.opening", model: { cli: "claude" } } };
  const store = {
    getAll: () => state,
    get: (k: string) => state[k] ?? null,
    set: async (k: string, cfg: any) => {
      if (cfg.model?.cli && !["claude","codex"].includes(cfg.model.cli)) throw new Error("invalid");
      state[k] = cfg;
    },
    remove: async (k: string) => { delete state[k]; },
  };
  const app = Fastify();
  registerConfigAgentsRoutes(app, { agentConfigStore: store as any });
  return { app, store };
}

describe("config-agents routes", () => {
  it("GET /api/config/agents returns map", async () => {
    const { app } = buildApp();
    const r = await app.inject({ method: "GET", url: "/api/config/agents" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).agents["writer.opening"].model.cli).toBe("claude");
  });
  it("PUT rejects bad cli", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "PUT", url: "/api/config/agents/writer.opening",
      payload: { agentKey: "writer.opening", model: { cli: "gpt" } },
    });
    expect(r.statusCode).toBe(400);
  });
  it("PUT rejects agentKey mismatch", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "PUT", url: "/api/config/agents/writer.opening",
      payload: { agentKey: "writer.closing", model: { cli: "claude" } },
    });
    expect(r.statusCode).toBe(400);
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/routes-config-agents.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T10): GET/PUT /api/config/agents routes"`

---

## T11 — Style panel list + delete routes

**Files:**
- Create: `packages/web-server/src/routes/config-style-panels.ts`
- Modify: `packages/web-server/src/server.ts` (register)
- Test: `packages/web-server/tests/routes-config-style-panels.test.ts`

**Steps:**
1. [ ] Export `registerConfigStylePanelsRoutes(app, deps: { stylePanelStore: StylePanelStore })`.
2. [ ] `GET /api/config/style-panels?account=&role=&include_deleted=0` → array of `{ account, role, version, status, created_at, absPath, source_article_count, is_legacy }`. Filters optional; default `include_deleted=0` hides deleted.
3. [ ] `DELETE /api/config/style-panels/:account/:role/:version` (soft) — `stylePanelStore.softDelete(...)` → `{ ok: true }` or 404.
4. [ ] `DELETE /api/config/style-panels/:account/:role/:version?hard=1` (hard) — `stylePanelStore.hardDelete(...)`.
5. [ ] URL-decode `:account` and `:role`.
6. [ ] Tests: list filters, soft delete marks status, hard delete removes.

**Test code sketch:**
```ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { registerConfigStylePanelsRoutes } from "../src/routes/config-style-panels.js";

function seeded() {
  const vault = mkdtempSync(join(tmpdir(), "sp10-r-"));
  const store = new StylePanelStore(vault);
  store.write({ frontmatter: { account: "A", role: "opening", version: 1, status: "active", created_at: "t", source_article_count: 1 }, body: "x", absPath: "" });
  store.write({ frontmatter: { account: "A", role: "opening", version: 2, status: "active", created_at: "t", source_article_count: 1 }, body: "x", absPath: "" });
  const app = Fastify();
  registerConfigStylePanelsRoutes(app, { stylePanelStore: store });
  return { app, store };
}

describe("config-style-panels routes", () => {
  it("GET lists both versions (active only by default)", async () => {
    const { app } = seeded();
    const r = await app.inject({ method: "GET", url: "/api/config/style-panels?account=A&role=opening" });
    expect(JSON.parse(r.body)).toHaveLength(2);
  });
  it("DELETE soft marks deleted", async () => {
    const { app, store } = seeded();
    const r = await app.inject({ method: "DELETE", url: "/api/config/style-panels/A/opening/2" });
    expect(r.statusCode).toBe(200);
    expect(store.getLatestActive("A", "opening")!.frontmatter.version).toBe(1);
  });
  it("DELETE hard=1 removes", async () => {
    const { app, store } = seeded();
    const r = await app.inject({ method: "DELETE", url: "/api/config/style-panels/A/opening/1?hard=1" });
    expect(r.statusCode).toBe(200);
    expect(store.list().filter(p => p.frontmatter.version === 1)).toHaveLength(0);
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/routes-config-style-panels.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T11): list + soft/hard delete routes for style panels"`

---

## T12 — Distill SSE route

**Files:**
- Create: `packages/web-server/src/routes/config-style-panels-distill.ts`
- Modify: `packages/web-server/src/server.ts` (register)
- Test: `packages/web-server/tests/routes-config-style-panels-distill.test.ts`

**Steps:**
1. [ ] Export `registerConfigStylePanelsDistillRoutes(app, deps: { vaultPath: string; sqlitePath: string; stylePanelStore: StylePanelStore; runRoleDistill?: typeof runRoleDistill })`. Accept orchestrator fn as override so tests can inject a stub.
2. [ ] `POST /api/config/style-panels/distill` body `{ account, role }`.
3. [ ] Validate: `role ∈ {"opening","practice","closing"}`, `account` non-empty → 400 otherwise.
4. [ ] Hijack `reply.raw`, set SSE headers (copy from `kb-style-panels.ts`).
5. [ ] Map orchestrator events to SSE:
   - `distill.started { account, role, run_id }`
   - `distill.slicer_progress { processed, total }`
   - `distill.snippets_done { count }`
   - `distill.structure_done {}`
   - `distill.composer_done { panel_path }`
   - On throw: `distill.failed { error }`.
6. [ ] Send final sentinel `distill.finished { panel_path, version }`, close stream.
7. [ ] Tests with injected fake `runRoleDistill` that emits scripted events. Assert SSE transcript contains the expected event names in order.

**Test code sketch:**
```ts
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerConfigStylePanelsDistillRoutes } from "../src/routes/config-style-panels-distill.js";

describe("distill SSE route", () => {
  it("streams started -> slicer_progress -> composer_done -> finished", async () => {
    const fakeRun = vi.fn(async (input: any, ctx: any) => {
      ctx.onEvent({ phase: "started", account: input.account, role: input.role, run_id: "rd-1" });
      ctx.onEvent({ phase: "slicer_progress", processed: 1, total: 2 });
      ctx.onEvent({ phase: "composer_done", panel_path: "/tmp/p.md" });
      return { panelPath: "/tmp/p.md", version: 1 };
    });
    const app = Fastify();
    registerConfigStylePanelsDistillRoutes(app, {
      vaultPath: "/tmp", sqlitePath: "/tmp/x.db", stylePanelStore: {} as any, runRoleDistill: fakeRun as any,
    });
    const r = await app.inject({ method: "POST", url: "/api/config/style-panels/distill", payload: { account: "A", role: "opening" } });
    expect(r.body).toContain("event: distill.started");
    expect(r.body).toContain("event: distill.slicer_progress");
    expect(r.body).toContain("event: distill.composer_done");
    expect(r.body).toContain("event: distill.finished");
  });
  it("400 on bad role", async () => {
    const app = Fastify();
    registerConfigStylePanelsDistillRoutes(app, { vaultPath: "/tmp", sqlitePath: "/tmp/x.db", stylePanelStore: {} as any });
    const r = await app.inject({ method: "POST", url: "/api/config/style-panels/distill", payload: { account: "A", role: "junk" } });
    expect(r.statusCode).toBe(400);
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/routes-config-style-panels-distill.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T12): POST /api/config/style-panels/distill SSE route"`

---

## T13 — Project override routes

**Files:**
- Create: `packages/web-server/src/routes/config-project-overrides.ts`
- Modify: `packages/web-server/src/server.ts` (register)
- Test: `packages/web-server/tests/routes-config-project-overrides.test.ts`

**Steps:**
1. [ ] Export `registerConfigProjectOverridesRoutes(app, deps: { projectOverrideStore: ProjectOverrideStore })`.
2. [ ] `GET /api/projects/:id/override` → returns `{ override: ProjectOverride | null }`.
3. [ ] `PUT /api/projects/:id/override` body `ProjectOverride` → validate: `agents` is object; each value's `model.cli` (if present) ∈ {claude,codex}; `styleBinding.role` (if present) ∈ {opening,practice,closing}. 400 on violation. Then `set(...)` + return `{ ok: true }`.
4. [ ] `DELETE /api/projects/:id/override` → `delete(...)` + `{ ok: true }`.
5. [ ] `DELETE /api/projects/:id/override/:agentKey` → `clear(id, agentKey)`.
6. [ ] Tests with in-memory fake `projectOverrideStore`.

**Test code sketch:**
```ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerConfigProjectOverridesRoutes } from "../src/routes/config-project-overrides.js";

function buildApp() {
  const state: Record<string, any> = {};
  const store = {
    get: (id: string) => state[id] ?? null,
    set: (id: string, o: any) => { state[id] = o; },
    clear: (id: string, ak: string) => { if (state[id]?.agents) delete state[id].agents[ak]; },
    delete: (id: string) => { delete state[id]; },
  };
  const app = Fastify();
  registerConfigProjectOverridesRoutes(app, { projectOverrideStore: store as any });
  return { app, state };
}

describe("project override routes", () => {
  it("GET returns null when none", async () => {
    const { app } = buildApp();
    const r = await app.inject({ method: "GET", url: "/api/projects/p1/override" });
    expect(JSON.parse(r.body).override).toBeNull();
  });
  it("PUT + GET roundtrip", async () => {
    const { app } = buildApp();
    await app.inject({
      method: "PUT", url: "/api/projects/p1/override",
      payload: { agents: { "writer.opening": { model: { cli: "codex", model: "gpt-5" } } } },
    });
    const r = await app.inject({ method: "GET", url: "/api/projects/p1/override" });
    expect(JSON.parse(r.body).override.agents["writer.opening"].model.cli).toBe("codex");
  });
  it("PUT 400 on bad cli", async () => {
    const { app } = buildApp();
    const r = await app.inject({
      method: "PUT", url: "/api/projects/p1/override",
      payload: { agents: { "writer.opening": { model: { cli: "gpt" } } } },
    });
    expect(r.statusCode).toBe(400);
  });
  it("DELETE clears single agent", async () => {
    const { app } = buildApp();
    await app.inject({ method: "PUT", url: "/api/projects/p1/override", payload: { agents: { "writer.opening": {}, "writer.closing": {} } } });
    const r = await app.inject({ method: "DELETE", url: "/api/projects/p1/override/writer.opening" });
    expect(r.statusCode).toBe(200);
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/routes-config-project-overrides.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -m "sp10(T13): project override GET/PUT/DELETE routes"`

---

<!-- PART2_MARKER -->
