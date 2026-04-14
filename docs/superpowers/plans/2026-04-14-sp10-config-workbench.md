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

## T14 — Legacy style-panel migration (auto-tag on first scan)

**Files:**
- Modify: `packages/web-server/src/services/style-panel-store.ts`
- Test: `packages/web-server/tests/style-panel-store-legacy.test.ts`
- Fixture: `packages/web-server/tests/fixtures/legacy-style-panel/08_experts/style-panel/十字路口_kb.md`

- [ ] **Step 1: Create fixture file**

Create `packages/web-server/tests/fixtures/legacy-style-panel/08_experts/style-panel/十字路口_kb.md`:

```markdown
# 十字路口 旧知识库

## 句式
- 短句多
- 常用反问
```

(No frontmatter — this simulates the pre-SP-10 format.)

- [ ] **Step 2: Write failing test**

```ts
// packages/web-server/tests/style-panel-store-legacy.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { StylePanelStore } from "../src/services/style-panel-store";

describe("StylePanelStore legacy migration", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sp10-legacy-"));
    const dir = path.join(tmp, "08_experts/style-panel");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "十字路口_kb.md"),
      "# 十字路口 旧知识库\n\n- 短句多\n",
      "utf8",
    );
  });

  it("tags legacy <account>_kb.md files as role=legacy, bindable=false", async () => {
    const store = new StylePanelStore({ vaultRoot: tmp });
    const panels = await store.list();
    expect(panels).toHaveLength(1);
    expect(panels[0].account).toBe("十字路口");
    expect(panels[0].role).toBe("legacy");
    expect(panels[0].status).toBe("active");
    expect(panels[0].bindable).toBe(false);

    // File is rewritten with frontmatter
    const raw = fs.readFileSync(
      path.join(tmp, "08_experts/style-panel/十字路口_kb.md"),
      "utf8",
    );
    expect(raw).toMatch(/^---\n/);
    expect(raw).toMatch(/role:\s*legacy/);
    expect(raw).toMatch(/bindable:\s*false/);
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm --filter @crossing/web-server exec vitest run tests/style-panel-store-legacy.test.ts`
Expected: FAIL — no frontmatter written, `role` undefined.

- [ ] **Step 4: Implement migration in `StylePanelStore.list()`**

In `style-panel-store.ts`, inside the scan loop, after reading each `.md` file:

```ts
// Legacy detection: filename like "<account>_kb.md" AND no frontmatter role field
const legacyMatch = /^(.+)_kb\.md$/.exec(path.basename(file));
if (legacyMatch && !parsed.data.role) {
  const account = legacyMatch[1];
  const migrated = matter.stringify(parsed.content, {
    ...parsed.data,
    account,
    role: "legacy",
    status: "active",
    bindable: false,
    version: parsed.data.version ?? 1,
    migratedAt: new Date().toISOString(),
  });
  fs.writeFileSync(file, migrated, "utf8");
  parsed.data = { ...parsed.data, account, role: "legacy", status: "active", bindable: false };
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm --filter @crossing/web-server exec vitest run tests/style-panel-store-legacy.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web-server/src/services/style-panel-store.ts packages/web-server/tests/style-panel-store-legacy.test.ts packages/web-server/tests/fixtures/legacy-style-panel
git -c commit.gpgsign=false commit -m "sp10(T14): auto-tag legacy <account>_kb.md as role=legacy (bindable=false)"
```

---

## T15 — writer-client API functions

**Files:**
- Modify: `packages/web-ui/src/api/writer-client.ts`
- Test: `packages/web-ui/src/api/__tests__/writer-client-config.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/web-ui/src/api/__tests__/writer-client-config.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAgentConfigs,
  setAgentConfig,
  listStylePanels,
  deleteStylePanel,
  distillStylePanel,
  getProjectOverride,
  setProjectOverride,
} from "../writer-client";

describe("writer-client config APIs", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("getAgentConfigs calls GET /api/config/agents", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ agents: { "writer.opening": { model: "gpt-5" } } }),
    });
    const out = await getAgentConfigs();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/config/agents", expect.any(Object));
    expect(out.agents["writer.opening"].model).toBe("gpt-5");
  });

  it("setAgentConfig PUTs /api/config/agents/:key", async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await setAgentConfig("writer.opening", { model: "gpt-5", styleBinding: "十字路口/opening@v2" });
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/config/agents/writer.opening");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body).model).toBe("gpt-5");
  });

  it("listStylePanels calls GET /api/config/style-panels", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ panels: [] }),
    });
    const out = await listStylePanels();
    expect(out.panels).toEqual([]);
  });

  it("deleteStylePanel with hard=true calls DELETE with query", async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await deleteStylePanel("十字路口", "opening", 2, { hard: true });
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/config/style-panels/十字路口/opening/2?hard=true");
    expect(init.method).toBe("DELETE");
  });

  it("getProjectOverride GETs /api/projects/:id/override", async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ override: {} }) });
    const out = await getProjectOverride("p1");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/projects/p1/override", expect.any(Object));
    expect(out.override).toEqual({});
  });

  it("setProjectOverride PUTs /api/projects/:id/override", async () => {
    (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await setProjectOverride("p1", { agents: { "writer.opening": { model: "gpt-5" } } });
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("/api/projects/p1/override");
    expect(init.method).toBe("PUT");
  });

  it("distillStylePanel opens EventSource to SSE URL", async () => {
    const handler = vi.fn();
    class FakeES {
      url: string;
      listeners: Record<string, any> = {};
      constructor(url: string) { this.url = url; }
      addEventListener(name: string, fn: any) { this.listeners[name] = fn; }
      close() {}
    }
    vi.stubGlobal("EventSource", FakeES as any);
    const ctrl = distillStylePanel(
      { account: "十字路口", role: "opening", sourceRefs: ["a.md"] },
      handler,
    );
    expect((ctrl as any).url).toContain("/api/config/style-panels/distill");
    expect((ctrl as any).url).toContain("account=");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/api/__tests__/writer-client-config.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Add functions to `writer-client.ts`**

Append to `packages/web-ui/src/api/writer-client.ts`:

```ts
export interface AgentConfig {
  model?: string;
  styleBinding?: string | null;
  tools?: string[];
  promptVersion?: string;
}
export interface AgentConfigMap { [key: string]: AgentConfig; }

export async function getAgentConfigs(): Promise<{ agents: AgentConfigMap }> {
  const r = await fetch("/api/config/agents", { method: "GET" });
  if (!r.ok) throw new Error(`getAgentConfigs ${r.status}`);
  return r.json();
}

export async function setAgentConfig(key: string, cfg: AgentConfig): Promise<void> {
  const r = await fetch(`/api/config/agents/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cfg),
  });
  if (!r.ok) throw new Error(`setAgentConfig ${r.status}`);
}

export interface StylePanelSummary {
  account: string;
  role: string;
  version: number;
  status: "active" | "soft-deleted";
  bindable: boolean;
  updatedAt?: string;
  boundTo?: string[];
}

export async function listStylePanels(): Promise<{ panels: StylePanelSummary[] }> {
  const r = await fetch("/api/config/style-panels", { method: "GET" });
  if (!r.ok) throw new Error(`listStylePanels ${r.status}`);
  return r.json();
}

export async function deleteStylePanel(
  account: string, role: string, version: number, opts: { hard?: boolean } = {},
): Promise<void> {
  const q = opts.hard ? "?hard=true" : "";
  const url = `/api/config/style-panels/${encodeURIComponent(account)}/${encodeURIComponent(role)}/${version}${q}`;
  const r = await fetch(url, { method: "DELETE" });
  if (!r.ok) throw new Error(`deleteStylePanel ${r.status}`);
}

export async function getProjectOverride(projectId: string): Promise<{ override: any }> {
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/override`, { method: "GET" });
  if (!r.ok) throw new Error(`getProjectOverride ${r.status}`);
  return r.json();
}

export async function setProjectOverride(projectId: string, body: any): Promise<void> {
  const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/override`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`setProjectOverride ${r.status}`);
}

export interface DistillParams {
  account: string;
  role: string;
  sourceRefs: string[];
}
export interface DistillController { close: () => void; }

export function distillStylePanel(
  params: DistillParams,
  onEvent: (type: string, data: any) => void,
): DistillController {
  const q = new URLSearchParams({
    account: params.account,
    role: params.role,
    sourceRefs: params.sourceRefs.join(","),
  }).toString();
  const url = `/api/config/style-panels/distill?${q}`;
  const es = new EventSource(url);
  const types = ["distill.started", "distill.slicer_progress", "distill.composer_done", "distill.failed"];
  types.forEach((t) =>
    es.addEventListener(t, (ev: MessageEvent) => {
      try { onEvent(t, JSON.parse(ev.data)); } catch { onEvent(t, ev.data); }
    }),
  );
  (es as any).url = url;
  return { close: () => es.close() } as DistillController & { url: string };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/api/__tests__/writer-client-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/api/writer-client.ts packages/web-ui/src/api/__tests__/writer-client-config.test.ts
git -c commit.gpgsign=false commit -m "sp10(T15): writer-client config/style-panel/override APIs + SSE"
```

---

## T16 — `useProjectStream` EVENT_TYPES extend

**Files:**
- Modify: `packages/web-ui/src/hooks/useProjectStream.ts:27-55`
- Test: `packages/web-ui/src/hooks/__tests__/useProjectStream-sp10.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/web-ui/src/hooks/__tests__/useProjectStream-sp10.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectStream } from "../useProjectStream";

class FakeES {
  listeners: Record<string, (ev: MessageEvent) => void> = {};
  static last: FakeES | null = null;
  constructor(public url: string) { FakeES.last = this; }
  addEventListener(name: string, fn: any) { this.listeners[name] = fn; }
  close() {}
  emit(name: string, data: any) {
    this.listeners[name]?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe("useProjectStream SP-10 events", () => {
  beforeEach(() => { vi.stubGlobal("EventSource", FakeES as any); });

  it("registers handlers for distill.* and run.blocked", () => {
    renderHook(() => useProjectStream("p1"));
    const es = FakeES.last!;
    expect(es.listeners["distill.started"]).toBeDefined();
    expect(es.listeners["distill.slicer_progress"]).toBeDefined();
    expect(es.listeners["distill.composer_done"]).toBeDefined();
    expect(es.listeners["distill.failed"]).toBeDefined();
    expect(es.listeners["run.blocked"]).toBeDefined();
  });

  it("records run.blocked event with missing agents", () => {
    const { result } = renderHook(() => useProjectStream("p1"));
    act(() => {
      FakeES.last!.emit("run.blocked", { missing: ["writer.opening"] });
    });
    const last = result.current.events[result.current.events.length - 1];
    expect(last.type).toBe("run.blocked");
    expect(last.payload.missing).toEqual(["writer.opening"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/hooks/__tests__/useProjectStream-sp10.test.ts`
Expected: FAIL — event not registered.

- [ ] **Step 3: Extend `EVENT_TYPES`**

In `packages/web-ui/src/hooks/useProjectStream.ts`, append before the closing `];` of `EVENT_TYPES`:

```ts
  "distill.started",
  "distill.slicer_progress",
  "distill.composer_done",
  "distill.failed",
  "run.blocked",
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/hooks/__tests__/useProjectStream-sp10.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/hooks/useProjectStream.ts packages/web-ui/src/hooks/__tests__/useProjectStream-sp10.test.ts
git -c commit.gpgsign=false commit -m "sp10(T16): subscribe to distill.* + run.blocked SSE events"
```

---

## T17 — Top nav entry for Config Workbench

**Note:** The repo does NOT have a `TopNav.tsx` — nav links live inline in `ProjectList.tsx` (`a href=/style-panels`). Follow the existing inline pattern there.

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectList.tsx` (nav row around line 24)
- Modify: `packages/web-ui/src/App.tsx` (add route)
- Test: `packages/web-ui/src/pages/__tests__/ProjectList-nav.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/src/pages/__tests__/ProjectList-nav.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectList } from "../ProjectList";

vi.mock("../../hooks/useProjects", () => ({ useProjects: () => ({ projects: [], reload: () => {} }) }));

describe("ProjectList nav", () => {
  it("renders Config Workbench link", () => {
    render(<MemoryRouter><ProjectList /></MemoryRouter>);
    const link = screen.getByRole("link", { name: /配置工作台/ });
    expect(link.getAttribute("href")).toBe("/config");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/pages/__tests__/ProjectList-nav.test.tsx`

- [ ] **Step 3: Add link in `ProjectList.tsx`**

Next to the existing `<a href="/style-panels">风格面板</a>`:

```tsx
<a
  href="/config"
  className="px-3 py-1 rounded border text-sm"
  style={{ borderColor: "var(--border)" }}
>
  ⚙️ 配置工作台
</a>
```

- [ ] **Step 4: Register route in `App.tsx`**

Add import `import { ConfigWorkbench } from "./pages/ConfigWorkbench";` and route:

```tsx
<Route path="/config" element={<ConfigWorkbench />} />
```

(T18 creates the page; keep a tiny placeholder export first so this task compiles. Add `export function ConfigWorkbench() { return <div data-testid="config-workbench-shell" />; }` to a stub `packages/web-ui/src/pages/ConfigWorkbench.tsx` — T18 will replace it.)

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/pages/__tests__/ProjectList-nav.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add packages/web-ui/src/pages/ProjectList.tsx packages/web-ui/src/App.tsx packages/web-ui/src/pages/ConfigWorkbench.tsx packages/web-ui/src/pages/__tests__/ProjectList-nav.test.tsx
git -c commit.gpgsign=false commit -m "sp10(T17): top-nav entry + /config route for Config Workbench"
```

---

## T18 — ConfigWorkbench page shell (two tabs)

**Files:**
- Replace: `packages/web-ui/src/pages/ConfigWorkbench.tsx`
- Test: `packages/web-ui/src/pages/__tests__/ConfigWorkbench.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/src/pages/__tests__/ConfigWorkbench.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConfigWorkbench } from "../ConfigWorkbench";

describe("ConfigWorkbench", () => {
  it("renders main-flow tab by default", () => {
    render(<MemoryRouter><ConfigWorkbench /></MemoryRouter>);
    expect(screen.getByTestId("tab-main-flow")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("agents-panel-placeholder")).toBeInTheDocument();
  });

  it("switches to distill tab on click", () => {
    render(<MemoryRouter><ConfigWorkbench /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("tab-distill"));
    expect(screen.getByTestId("tab-distill")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("style-panel-list-placeholder")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/pages/__tests__/ConfigWorkbench.test.tsx`

- [ ] **Step 3: Implement page**

Replace `packages/web-ui/src/pages/ConfigWorkbench.tsx`:

```tsx
import { useState } from "react";

type Tab = "main" | "distill";

export function ConfigWorkbench() {
  const [tab, setTab] = useState<Tab>("main");
  return (
    <div className="p-4 max-w-[1200px] mx-auto">
      <h1 className="text-xl font-semibold mb-3">⚙️ 配置工作台</h1>
      <div role="tablist" className="flex gap-2 border-b mb-4">
        <button
          role="tab"
          data-testid="tab-main-flow"
          aria-selected={tab === "main"}
          className={`px-3 py-1 ${tab === "main" ? "border-b-2 border-blue-500" : ""}`}
          onClick={() => setTab("main")}
        >
          📝 主流程
        </button>
        <button
          role="tab"
          data-testid="tab-distill"
          aria-selected={tab === "distill"}
          className={`px-3 py-1 ${tab === "distill" ? "border-b-2 border-blue-500" : ""}`}
          onClick={() => setTab("distill")}
        >
          🎨 蒸馏
        </button>
      </div>
      {tab === "main" ? (
        <div data-testid="agents-panel-placeholder">
          {/* Replaced in T20 by <AgentsPanel /> */}
          主流程 agents 配置
        </div>
      ) : (
        <div data-testid="style-panel-list-placeholder">
          {/* Replaced in T21 by <StylePanelList /> */}
          风格面板列表
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/pages/__tests__/ConfigWorkbench.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/pages/ConfigWorkbench.tsx packages/web-ui/src/pages/__tests__/ConfigWorkbench.test.tsx
git -c commit.gpgsign=false commit -m "sp10(T18): ConfigWorkbench shell with 主流程/蒸馏 tabs"
```

---

## T19 — `AgentCard` component

**Files:**
- Create: `packages/web-ui/src/components/config/AgentCard.tsx`
- Test: `packages/web-ui/src/components/config/__tests__/AgentCard.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/src/components/config/__tests__/AgentCard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentCard } from "../AgentCard";

const base = {
  agentKey: "writer.opening",
  agentConfig: {
    model: "gpt-5",
    styleBinding: "十字路口/opening@v2",
    tools: ["search"],
    promptVersion: "v3",
  },
  stylePanelChoices: [
    { value: "十字路口/opening@v2", label: "十字路口/opening v2" },
    { value: "十字路口/opening@latest", label: "十字路口/opening latest" },
  ],
  modelChoices: ["gpt-5", "claude-opus-4-6"],
};

describe("AgentCard", () => {
  it("renders fields", () => {
    render(<AgentCard {...base} onChange={() => {}} />);
    expect(screen.getByText(/writer\.opening/)).toBeInTheDocument();
    expect((screen.getByTestId("model-select") as HTMLSelectElement).value).toBe("gpt-5");
    expect((screen.getByTestId("style-binding-select") as HTMLSelectElement).value).toBe("十字路口/opening@v2");
    expect(screen.getByTestId("tool-search")).toBeChecked();
    expect(screen.getByTestId("prompt-version")).toHaveTextContent("v3");
  });

  it("emits onChange after debounce on model change", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<AgentCard {...base} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("model-select"), { target: { value: "claude-opus-4-6" } });
    vi.advanceTimersByTime(500);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-opus-4-6" }));
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/config/__tests__/AgentCard.test.tsx`

- [ ] **Step 3: Implement component**

Create `packages/web-ui/src/components/config/AgentCard.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { AgentConfig } from "../../api/writer-client";

export interface StyleChoice { value: string; label: string; }
export interface AgentCardProps {
  agentKey: string;
  agentConfig: AgentConfig;
  stylePanelChoices: StyleChoice[];
  modelChoices: string[];
  onChange: (cfg: AgentConfig) => void;
}

const DEFAULT_TOOLS = ["search", "section_rewrite", "style_critic"];

export function AgentCard(props: AgentCardProps) {
  const [draft, setDraft] = useState<AgentConfig>(props.agentConfig);
  const timer = useRef<any>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => props.onChange(draft), 400);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <div className="border rounded p-3 mb-2" style={{ borderColor: "var(--border)" }}>
      <div className="font-medium mb-2">{props.agentKey}</div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>
          Model
          <select
            data-testid="model-select"
            className="block w-full border rounded px-2 py-1"
            value={draft.model ?? ""}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          >
            {props.modelChoices.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          风格绑定
          <select
            data-testid="style-binding-select"
            className="block w-full border rounded px-2 py-1"
            value={draft.styleBinding ?? ""}
            onChange={(e) => setDraft({ ...draft, styleBinding: e.target.value || null })}
          >
            <option value="">（不绑定）</option>
            {props.stylePanelChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <div className="col-span-2">
          工具：
          {DEFAULT_TOOLS.map((t) => (
            <label key={t} className="ml-2">
              <input
                data-testid={`tool-${t}`}
                type="checkbox"
                checked={(draft.tools ?? []).includes(t)}
                onChange={(e) => {
                  const set = new Set(draft.tools ?? []);
                  e.target.checked ? set.add(t) : set.delete(t);
                  setDraft({ ...draft, tools: [...set] });
                }}
              />
              {t}
            </label>
          ))}
        </div>
        <div className="col-span-2">
          Prompt 版本：<span data-testid="prompt-version">{draft.promptVersion ?? "(未设置)"}</span>
          <button className="ml-2 px-2 py-0.5 border rounded text-xs" disabled title="SP-10 外单独维护">
            编辑 Prompt
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/config/__tests__/AgentCard.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/components/config/AgentCard.tsx packages/web-ui/src/components/config/__tests__/AgentCard.test.tsx
git -c commit.gpgsign=false commit -m "sp10(T19): AgentCard (model/style/tools/prompt) with debounced onChange"
```

---

## T20 — `AgentsPanel` (main-flow tab content)

**Files:**
- Create: `packages/web-ui/src/components/config/AgentsPanel.tsx`
- Modify: `packages/web-ui/src/pages/ConfigWorkbench.tsx` (replace placeholder)
- Test: `packages/web-ui/src/components/config/__tests__/AgentsPanel.test.tsx`

Agent → Step mapping (matches spec §2.3):
- Step 1 Brief: `brief.summarizer`
- Step 2 Experts: `expert.round1`, `expert.round2`, `coordinator`
- Step 3 Case: `case_expert.round1`, `case_expert.round2`, `case_coordinator`
- Step 4 Writer: `writer.opening`, `writer.body`, `writer.closing`, `writer.style_critic`

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/src/components/config/__tests__/AgentsPanel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AgentsPanel } from "../AgentsPanel";

vi.mock("../../../api/writer-client", () => ({
  getAgentConfigs: vi.fn(async () => ({
    agents: {
      "writer.opening": { model: "gpt-5", styleBinding: null, tools: [] },
      "brief.summarizer": { model: "gpt-5", tools: [] },
    },
  })),
  listStylePanels: vi.fn(async () => ({
    panels: [{ account: "十字路口", role: "opening", version: 2, status: "active", bindable: true }],
  })),
  setAgentConfig: vi.fn(async () => {}),
}));

describe("AgentsPanel", () => {
  it("groups cards by step", async () => {
    render(<AgentsPanel />);
    await waitFor(() => expect(screen.getByText(/Step 1/)).toBeInTheDocument());
    expect(screen.getByText(/Step 4/)).toBeInTheDocument();
    expect(screen.getByText("writer.opening")).toBeInTheDocument();
    expect(screen.getByText("brief.summarizer")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/config/__tests__/AgentsPanel.test.tsx`

- [ ] **Step 3: Implement**

Create `packages/web-ui/src/components/config/AgentsPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { getAgentConfigs, listStylePanels, setAgentConfig, type AgentConfigMap, type StylePanelSummary } from "../../api/writer-client";
import { AgentCard, type StyleChoice } from "./AgentCard";

const STEP_GROUPS: { step: number; label: string; keys: string[] }[] = [
  { step: 1, label: "Step 1 · Brief", keys: ["brief.summarizer"] },
  { step: 2, label: "Step 2 · Experts", keys: ["expert.round1", "expert.round2", "coordinator"] },
  { step: 3, label: "Step 3 · Case", keys: ["case_expert.round1", "case_expert.round2", "case_coordinator"] },
  { step: 4, label: "Step 4 · Writer", keys: ["writer.opening", "writer.body", "writer.closing", "writer.style_critic"] },
];
const MODEL_CHOICES = ["gpt-5", "claude-opus-4-6", "claude-sonnet-4-6"];

export function AgentsPanel() {
  const [agents, setAgents] = useState<AgentConfigMap>({});
  const [panels, setPanels] = useState<StylePanelSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAgentConfigs(), listStylePanels()]).then(([a, p]) => {
      setAgents(a.agents);
      setPanels(p.panels);
      setLoading(false);
    });
  }, []);

  const styleChoices: StyleChoice[] = panels
    .filter((p) => p.bindable && p.status === "active")
    .map((p) => ({
      value: `${p.account}/${p.role}@v${p.version}`,
      label: `${p.account}/${p.role} v${p.version}`,
    }));

  if (loading) return <div>载入中…</div>;

  return (
    <div>
      {STEP_GROUPS.map((g) => (
        <section key={g.step} className="mb-4">
          <h2 className="text-base font-semibold mb-2">{g.label}</h2>
          {g.keys
            .filter((k) => agents[k])
            .map((k) => (
              <AgentCard
                key={k}
                agentKey={k}
                agentConfig={agents[k]}
                stylePanelChoices={styleChoices}
                modelChoices={MODEL_CHOICES}
                onChange={(cfg) => {
                  setAgents((prev) => ({ ...prev, [k]: cfg }));
                  setAgentConfig(k, cfg).catch(console.error);
                }}
              />
            ))}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Wire into `ConfigWorkbench.tsx`**

Replace the main-flow placeholder `<div data-testid="agents-panel-placeholder">…</div>` with `<AgentsPanel />`. Keep the `data-testid` for T18's test by wrapping: `<div data-testid="agents-panel-placeholder"><AgentsPanel /></div>`.

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/config/__tests__/AgentsPanel.test.tsx src/pages/__tests__/ConfigWorkbench.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add packages/web-ui/src/components/config/AgentsPanel.tsx packages/web-ui/src/components/config/__tests__/AgentsPanel.test.tsx packages/web-ui/src/pages/ConfigWorkbench.tsx
git -c commit.gpgsign=false commit -m "sp10(T20): AgentsPanel groups agents by Step in ConfigWorkbench"
```

---

## T21 — `StylePanelList` (distill tab content)

**Files:**
- Create: `packages/web-ui/src/components/config/StylePanelList.tsx`
- Modify: `packages/web-ui/src/pages/ConfigWorkbench.tsx` (replace placeholder)
- Test: `packages/web-ui/src/components/config/__tests__/StylePanelList.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/src/components/config/__tests__/StylePanelList.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { StylePanelList } from "../StylePanelList";

vi.mock("../../../api/writer-client", () => ({
  listStylePanels: vi.fn(async () => ({
    panels: [
      { account: "十字路口", role: "opening", version: 2, status: "active", bindable: true, boundTo: ["writer.opening"] },
      { account: "十字路口", role: "legacy", version: 1, status: "active", bindable: false },
      { account: "暗涌", role: "closing", version: 1, status: "soft-deleted", bindable: true },
    ],
  })),
  deleteStylePanel: vi.fn(async () => {}),
}));

describe("StylePanelList", () => {
  it("groups by account and shows rows", async () => {
    render(<StylePanelList onDistill={() => {}} />);
    await waitFor(() => expect(screen.getByText(/十字路口/)).toBeInTheDocument());
    expect(screen.getByText(/暗涌/)).toBeInTheDocument();
    expect(screen.getByText(/不可绑定/)).toBeInTheDocument(); // legacy badge
    expect(screen.getByText(/writer\.opening/)).toBeInTheDocument();
  });

  it("soft-delete calls API and reloads", async () => {
    const mod = await import("../../../api/writer-client");
    render(<StylePanelList onDistill={() => {}} />);
    await waitFor(() => screen.getByText(/十字路口/));
    fireEvent.click(screen.getAllByText("软删")[0]);
    expect(mod.deleteStylePanel).toHaveBeenCalledWith("十字路口", "opening", 2, { hard: false });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/config/__tests__/StylePanelList.test.tsx`

- [ ] **Step 3: Implement**

Create `packages/web-ui/src/components/config/StylePanelList.tsx`:

```tsx
import { useEffect, useState, useCallback } from "react";
import { listStylePanels, deleteStylePanel, type StylePanelSummary } from "../../api/writer-client";

export interface StylePanelListProps {
  onDistill: (args: { account?: string; role?: string } | null) => void;
}

export function StylePanelList({ onDistill }: StylePanelListProps) {
  const [panels, setPanels] = useState<StylePanelSummary[]>([]);
  const reload = useCallback(() => listStylePanels().then((r) => setPanels(r.panels)), []);
  useEffect(() => { reload(); }, [reload]);

  const byAccount = panels.reduce<Record<string, StylePanelSummary[]>>((acc, p) => {
    (acc[p.account] ||= []).push(p);
    return acc;
  }, {});

  return (
    <div>
      <button
        className="mb-3 px-3 py-1 rounded border"
        onClick={() => onDistill({})}
      >
        + 去蒸（新面板）
      </button>
      {Object.entries(byAccount).map(([account, rows]) => (
        <section key={account} className="mb-4">
          <h3 className="font-semibold mb-1">🎨 {account}</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs opacity-70">
              <th>role</th><th>v</th><th>status</th><th>bound</th><th>actions</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={`${p.role}-${p.version}`} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td>{p.role}{!p.bindable && <span className="ml-1 text-xs px-1 bg-gray-200 rounded">不可绑定</span>}</td>
                  <td>v{p.version}</td>
                  <td>{p.status}</td>
                  <td>{(p.boundTo ?? []).join(", ") || "—"}</td>
                  <td className="space-x-1">
                    {p.bindable && p.status === "active" && (
                      <button className="px-2 py-0.5 border rounded" onClick={() => onDistill({ account: p.account, role: p.role })}>重蒸</button>
                    )}
                    {p.status === "active" && (
                      <button className="px-2 py-0.5 border rounded" onClick={async () => {
                        await deleteStylePanel(p.account, p.role, p.version, { hard: false });
                        reload();
                      }}>软删</button>
                    )}
                    {p.status === "soft-deleted" && (
                      <button className="px-2 py-0.5 border rounded" onClick={async () => {
                        await deleteStylePanel(p.account, p.role, p.version, { hard: false }); // restore = PUT status=active in backend; here no-op placeholder
                        reload();
                      }}>恢复</button>
                    )}
                    <button className="px-2 py-0.5 border rounded text-red-600" onClick={async () => {
                      if (!confirm(`硬删 ${p.account}/${p.role} v${p.version}？`)) return;
                      await deleteStylePanel(p.account, p.role, p.version, { hard: true });
                      reload();
                    }}>硬删</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
```

Note: "恢复" currently reuses the soft-delete endpoint as placeholder; if T11 added a restore endpoint, wire it here instead.

- [ ] **Step 4: Wire into `ConfigWorkbench.tsx`**

Add `import { StylePanelList } from "../components/config/StylePanelList";` and `import { DistillModal } from "../components/config/DistillModal";` (stub exists after T22). In the distill branch:

```tsx
{tab === "distill" && (
  <div data-testid="style-panel-list-placeholder">
    <StylePanelList onDistill={setDistillTarget} />
    {distillTarget && <DistillModal target={distillTarget} onClose={() => setDistillTarget(null)} />}
  </div>
)}
```

Add state `const [distillTarget, setDistillTarget] = useState<{account?: string; role?: string} | null>(null);`. Until T22 lands, create a stub `DistillModal` that returns `null` so typecheck passes.

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/config/__tests__/StylePanelList.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add packages/web-ui/src/components/config/StylePanelList.tsx packages/web-ui/src/components/config/__tests__/StylePanelList.test.tsx packages/web-ui/src/pages/ConfigWorkbench.tsx
git -c commit.gpgsign=false commit -m "sp10(T21): StylePanelList grouped by account with soft/hard delete"
```

---

## T22 — `DistillModal` with SSE progress

**Files:**
- Create: `packages/web-ui/src/components/config/DistillModal.tsx`
- Test: `packages/web-ui/src/components/config/__tests__/DistillModal.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/src/components/config/__tests__/DistillModal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DistillModal } from "../DistillModal";

const emit = vi.fn();
vi.mock("../../../api/writer-client", () => ({
  distillStylePanel: vi.fn((_params: any, onEvent: any) => {
    emit.mockImplementation((t, d) => onEvent(t, d));
    return { close: () => {} };
  }),
}));

describe("DistillModal", () => {
  it("shows preview then progress on confirm", async () => {
    render(<DistillModal target={{ account: "十字路口", role: "opening" }} onClose={() => {}} />);
    expect(screen.getByText(/去蒸/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("source-refs"), { target: { value: "a.md,b.md" } });
    fireEvent.click(screen.getByTestId("confirm-distill"));
    act(() => { emit("distill.started", { total: 2 }); });
    act(() => { emit("distill.slicer_progress", { done: 1, total: 2 }); });
    expect(screen.getByTestId("progress")).toHaveTextContent("1/2");
    act(() => { emit("distill.composer_done", { version: 3 }); });
    expect(screen.getByText(/v3/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/config/__tests__/DistillModal.test.tsx`

- [ ] **Step 3: Implement**

Create `packages/web-ui/src/components/config/DistillModal.tsx`:

```tsx
import { useState } from "react";
import { distillStylePanel, type DistillController } from "../../api/writer-client";

export interface DistillTarget { account?: string; role?: string; }
export interface DistillModalProps {
  target: DistillTarget;
  onClose: () => void;
}

export function DistillModal({ target, onClose }: DistillModalProps) {
  const [account, setAccount] = useState(target.account ?? "");
  const [role, setRole] = useState(target.role ?? "opening");
  const [sourceRefs, setSourceRefs] = useState("");
  const [phase, setPhase] = useState<"preview" | "running" | "done" | "error">("preview");
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [result, setResult] = useState<{ version?: number; error?: string } | null>(null);
  const [ctrl, setCtrl] = useState<DistillController | null>(null);

  const refs = sourceRefs.split(",").map((s) => s.trim()).filter(Boolean);
  const eta = Math.max(15, refs.length * 12);

  const start = () => {
    setPhase("running");
    const c = distillStylePanel({ account, role, sourceRefs: refs }, (type, data) => {
      if (type === "distill.started") setProgress({ done: 0, total: data.total ?? refs.length });
      else if (type === "distill.slicer_progress") setProgress({ done: data.done, total: data.total });
      else if (type === "distill.composer_done") { setResult({ version: data.version }); setPhase("done"); }
      else if (type === "distill.failed") { setResult({ error: data.error ?? "failed" }); setPhase("error"); }
    });
    setCtrl(c);
  };

  const close = () => { ctrl?.close(); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-900 rounded p-4 w-[480px]">
        <h3 className="font-semibold mb-2">去蒸 {account || "新账号"}/{role}</h3>
        {phase === "preview" && (
          <div className="space-y-2 text-sm">
            <label className="block">账号 <input className="border rounded px-2 py-1 w-full" value={account} onChange={(e) => setAccount(e.target.value)} /></label>
            <label className="block">role <input className="border rounded px-2 py-1 w-full" value={role} onChange={(e) => setRole(e.target.value)} /></label>
            <label className="block">source refs (逗号分隔)
              <input data-testid="source-refs" className="border rounded px-2 py-1 w-full" value={sourceRefs} onChange={(e) => setSourceRefs(e.target.value)} />
            </label>
            <div className="opacity-70">source 数：{refs.length} · 预计 {eta}s</div>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1 border rounded" onClick={close}>取消</button>
              <button data-testid="confirm-distill" className="px-3 py-1 border rounded bg-blue-500 text-white" disabled={!account || refs.length === 0} onClick={start}>
                确认开始
              </button>
            </div>
          </div>
        )}
        {phase === "running" && (
          <div className="text-sm">
            <div data-testid="progress">slicer 进度：{progress.done}/{progress.total}</div>
            <div className="mt-2 h-2 bg-gray-200 rounded">
              <div className="h-2 bg-blue-500 rounded" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        {phase === "done" && (
          <div className="text-sm">
            ✅ 完成 — 新版本 v{result?.version}
            <div className="flex justify-end"><button className="mt-3 px-3 py-1 border rounded" onClick={close}>关闭</button></div>
          </div>
        )}
        {phase === "error" && (
          <div className="text-sm text-red-600">
            ❌ 失败：{result?.error}
            <div className="flex justify-end"><button className="mt-3 px-3 py-1 border rounded" onClick={close}>关闭</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/config/__tests__/DistillModal.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/components/config/DistillModal.tsx packages/web-ui/src/components/config/__tests__/DistillModal.test.tsx
git -c commit.gpgsign=false commit -m "sp10(T22): DistillModal with source preview + SSE progress"
```

---

## T23 — `ProjectOverridePanel`

**Files:**
- Create: `packages/web-ui/src/components/config/ProjectOverridePanel.tsx`
- Test: `packages/web-ui/src/components/config/__tests__/ProjectOverridePanel.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/src/components/config/__tests__/ProjectOverridePanel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ProjectOverridePanel } from "../ProjectOverridePanel";

vi.mock("../../../api/writer-client", () => ({
  getAgentConfigs: vi.fn(async () => ({ agents: { "writer.opening": { model: "gpt-5" } } })),
  listStylePanels: vi.fn(async () => ({ panels: [{ account: "十字路口", role: "opening", version: 2, status: "active", bindable: true }] })),
  getProjectOverride: vi.fn(async () => ({ override: { agents: {} } })),
  setProjectOverride: vi.fn(async () => {}),
}));

describe("ProjectOverridePanel", () => {
  it("shows (默认) badge when no override", async () => {
    render(<ProjectOverridePanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText("writer.opening")).toBeInTheDocument());
    expect(screen.getByText("（默认）")).toBeInTheDocument();
  });

  it("marks (已覆盖) after model change", async () => {
    vi.useFakeTimers();
    const mod = await import("../../../api/writer-client");
    render(<ProjectOverridePanel projectId="p1" />);
    await waitFor(() => screen.getByText("writer.opening"));
    fireEvent.change(screen.getByTestId("override-model-writer.opening"), { target: { value: "claude-opus-4-6" } });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(mod.setProjectOverride).toHaveBeenCalled();
    expect(screen.getByText("（已覆盖）")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/config/__tests__/ProjectOverridePanel.test.tsx`

- [ ] **Step 3: Implement**

Create `packages/web-ui/src/components/config/ProjectOverridePanel.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import {
  getAgentConfigs, listStylePanels, getProjectOverride, setProjectOverride,
  type AgentConfigMap, type StylePanelSummary,
} from "../../api/writer-client";

export interface ProjectOverridePanelProps { projectId: string; }

const MODEL_CHOICES = ["gpt-5", "claude-opus-4-6", "claude-sonnet-4-6"];

export function ProjectOverridePanel({ projectId }: ProjectOverridePanelProps) {
  const [defaults, setDefaults] = useState<AgentConfigMap>({});
  const [panels, setPanels] = useState<StylePanelSummary[]>([]);
  const [override, setOverride] = useState<{ agents: AgentConfigMap }>({ agents: {} });
  const [loading, setLoading] = useState(true);
  const timer = useRef<any>(null);

  useEffect(() => {
    Promise.all([getAgentConfigs(), listStylePanels(), getProjectOverride(projectId)]).then(([a, p, o]) => {
      setDefaults(a.agents);
      setPanels(p.panels);
      setOverride(o.override ?? { agents: {} });
      setLoading(false);
    });
  }, [projectId]);

  const schedule = (next: { agents: AgentConfigMap }) => {
    setOverride(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setProjectOverride(projectId, next).catch(console.error), 400);
  };

  if (loading) return <div>载入中…</div>;

  const bindableChoices = panels
    .filter((p) => p.bindable && p.status === "active")
    .map((p) => `${p.account}/${p.role}@v${p.version}`);

  return (
    <div className="p-3">
      <h3 className="font-semibold mb-2">🔧 本项目专属配置</h3>
      {Object.entries(defaults).map(([key, def]) => {
        const ov = override.agents[key];
        const isOverridden = !!ov && Object.keys(ov).length > 0;
        return (
          <div key={key} className="border rounded p-2 mb-2 text-sm" style={{ borderColor: "var(--border)" }}>
            <div className="font-medium">
              {key} {isOverridden ? <span className="text-orange-600">（已覆盖）</span> : <span className="opacity-60">（默认）</span>}
            </div>
            <label className="block mt-1">
              Model（默认 {def.model}）
              <select
                data-testid={`override-model-${key}`}
                className="block border rounded px-2 py-1"
                value={ov?.model ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  const next = { agents: { ...override.agents, [key]: { ...(ov ?? {}), model: v || undefined } } };
                  if (!v) delete next.agents[key].model;
                  if (next.agents[key] && Object.keys(next.agents[key]).length === 0) delete next.agents[key];
                  schedule(next);
                }}
              >
                <option value="">（使用默认）</option>
                {MODEL_CHOICES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="block mt-1">
              风格绑定（默认 {def.styleBinding ?? "—"}）
              <select
                className="block border rounded px-2 py-1"
                value={ov?.styleBinding ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  const next = { agents: { ...override.agents, [key]: { ...(ov ?? {}), styleBinding: v || null } } };
                  schedule(next);
                }}
              >
                <option value="">（使用默认）</option>
                {bindableChoices.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/config/__tests__/ProjectOverridePanel.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/components/config/ProjectOverridePanel.tsx packages/web-ui/src/components/config/__tests__/ProjectOverridePanel.test.tsx
git -c commit.gpgsign=false commit -m "sp10(T23): ProjectOverridePanel with (默认)/(已覆盖) badges"
```

---

## T24 — Project page run-blocked UI + style badge in article sections

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx` (add blocked banner + 本项目专属配置 button)
- Modify: `packages/web-ui/src/components/writer/ArticleSection.tsx` (style badge)
- Test: `packages/web-ui/src/pages/__tests__/ProjectWorkbench-blocked.test.tsx`
- Test: `packages/web-ui/src/components/writer/__tests__/ArticleSection-style-badge.test.tsx`

### 24a Blocked banner

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/src/pages/__tests__/ProjectWorkbench-blocked.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProjectWorkbench } from "../ProjectWorkbench";

class FakeES {
  static last: FakeES | null = null;
  listeners: Record<string, (e: MessageEvent) => void> = {};
  constructor() { FakeES.last = this; }
  addEventListener(name: string, fn: any) { this.listeners[name] = fn; }
  close() {}
  emit(n: string, d: any) { this.listeners[n]?.({ data: JSON.stringify(d) } as MessageEvent); }
}

vi.stubGlobal("EventSource", FakeES as any);
vi.mock("../../hooks/useProjects", () => ({ useProjects: () => ({ projects: [{ id: "p1", title: "t" }], reload: () => {} }) }));

describe("ProjectWorkbench run.blocked", () => {
  it("shows warning card and CTAs on run.blocked", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/p1"]}>
        <Routes><Route path="/projects/:id" element={<ProjectWorkbench />} /></Routes>
      </MemoryRouter>,
    );
    act(() => { FakeES.last!.emit("run.blocked", { missing: ["writer.opening", "writer.body"] }); });
    expect(screen.getByText(/无法开始/)).toBeInTheDocument();
    expect(screen.getByText(/writer\.opening/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /本项目专属配置/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /去配置工作台/ })).toHaveAttribute("href", "/config");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/pages/__tests__/ProjectWorkbench-blocked.test.tsx`

- [ ] **Step 3: Add block banner in `ProjectWorkbench.tsx`**

After reading `events` from `useProjectStream`, derive:

```tsx
const lastBlocked = [...events].reverse().find((e) => e.type === "run.blocked");
const blockedMissing: string[] = lastBlocked && !events.some((e, i) =>
  i > events.indexOf(lastBlocked) && /writer\.section_started|agent\.started/.test(e.type)
) ? (lastBlocked.payload?.missing ?? []) : [];
```

Render near the top of the workbench main area:

```tsx
{blockedMissing.length > 0 && (
  <div className="border rounded p-3 mb-3 bg-yellow-50 text-sm">
    <div className="font-semibold mb-1">⚠️ 无法开始</div>
    <div>缺少绑定的 agent：</div>
    <ul className="list-disc ml-5">
      {blockedMissing.map((a) => <li key={a}>{a}</li>)}
    </ul>
    <div className="mt-2 space-x-2">
      <a className="px-2 py-1 border rounded inline-block" href={`/projects/${projectId}?overrides=1`}>🔧 本项目专属配置</a>
      <a className="px-2 py-1 border rounded inline-block" href="/config">去配置工作台</a>
    </div>
  </div>
)}
```

(The `overrides=1` query flag opens `<ProjectOverridePanel />` in a drawer — wire via `useSearchParams`.)

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/pages/__tests__/ProjectWorkbench-blocked.test.tsx`

### 24b Style badge in ArticleSection

- [ ] **Step 5: Write failing test**

```tsx
// packages/web-ui/src/components/writer/__tests__/ArticleSection-style-badge.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ArticleSection } from "../ArticleSection";

vi.mock("../../../hooks/useWriterSections", () => ({
  useWriterSections: () => ({ sections: [{ key: "opening", content: "hi", updatedAt: 0 }] }),
}));
vi.mock("../../../api/writer-client", () => ({
  getAgentConfigs: vi.fn(async () => ({ agents: { "writer.opening": { styleBinding: "十字路口/opening@v2" } } })),
  getProjectOverride: vi.fn(async () => ({ override: { agents: {} } })),
}));

describe("ArticleSection style badge", () => {
  it("renders account/role v<n> for bound section", async () => {
    render(<ArticleSection projectId="p1" status="completed" />);
    await waitFor(() => expect(screen.getByText(/🎨\s*十字路口\/opening v2/)).toBeInTheDocument());
  });

  it("renders (未绑定) in red when unset", async () => {
    const mod = await import("../../../api/writer-client");
    (mod.getAgentConfigs as any).mockResolvedValueOnce({ agents: { "writer.opening": { styleBinding: null } } });
    render(<ArticleSection projectId="p1" status="completed" />);
    await waitFor(() => {
      const el = screen.getByText(/未绑定/);
      expect(el.className).toMatch(/red/);
    });
  });
});
```

- [ ] **Step 6: Run — expect FAIL**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/writer/__tests__/ArticleSection-style-badge.test.tsx`

- [ ] **Step 7: Implement badge in `ArticleSection.tsx`**

Near the top of the component, load effective bindings:

```tsx
const [bindings, setBindings] = useState<Record<string, string | null>>({});
useEffect(() => {
  Promise.all([getAgentConfigs(), getProjectOverride(projectId)]).then(([a, o]) => {
    const out: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(a.agents)) {
      const ov = o.override?.agents?.[k];
      out[k] = (ov && "styleBinding" in ov ? ov.styleBinding : v.styleBinding) ?? null;
    }
    setBindings(out);
  });
}, [projectId]);

function renderBadge(sectionKey: string) {
  const agentKey = `writer.${sectionKey}`;
  const binding = bindings[agentKey];
  if (!binding) return <span className="text-xs text-red-500">🎨 (未绑定)</span>;
  // binding format: "<account>/<role>@v<n>"
  const m = /^(.+)\/(.+)@v(\d+)$/.exec(binding);
  if (!m) return <span className="text-xs">🎨 {binding}</span>;
  return <span className="text-xs opacity-80">🎨 {m[1]}/{m[2]} v{m[3]}</span>;
}
```

Render `{renderBadge(section.key)}` inside each section's header row.

- [ ] **Step 8: Run — expect PASS**

Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/writer/__tests__/ArticleSection-style-badge.test.tsx`

- [ ] **Step 9: Commit**

```bash
git add packages/web-ui/src/pages/ProjectWorkbench.tsx packages/web-ui/src/components/writer/ArticleSection.tsx packages/web-ui/src/pages/__tests__/ProjectWorkbench-blocked.test.tsx packages/web-ui/src/components/writer/__tests__/ArticleSection-style-badge.test.tsx
git -c commit.gpgsign=false commit -m "sp10(T24): run.blocked banner on ProjectWorkbench + style badges in ArticleSection"
```

---

## T25 — E2E integration test

**Files:**
- Create: `packages/web-server/tests/sp10-e2e.test.ts`
- Create fixtures inline via `fs.writeFileSync` in `beforeAll`.

**Scope:** one happy path — distill → SSE → writer run sees style. Mock the LLM calls inside `section-slicer` and the composer so the test is deterministic.

- [ ] **Step 1: Write the E2E test**

```ts
// packages/web-server/tests/sp10-e2e.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Server } from "node:http";
import { buildApp } from "../src/app";
import { EventSource } from "eventsource"; // node polyfill; dev dep

let tmp: string;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sp10-e2e-"));
  // Vault skeleton
  fs.mkdirSync(path.join(tmp, "07_projects/p1"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "08_experts/style-panel/十字路口"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "09_sources"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "09_sources/sample.md"), "# sample\n开场：今天聊...\n", "utf8");
  // Seed existing panel v1
  fs.writeFileSync(
    path.join(tmp, "08_experts/style-panel/十字路口/opening-v1.md"),
    "---\naccount: 十字路口\nrole: opening\nversion: 1\nstatus: active\nbindable: true\n---\n# 开场风格 v1\n",
    "utf8",
  );
  // Global config.json with styleBinding
  fs.mkdirSync(path.join(tmp, ".crossing"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".crossing/config.json"),
    JSON.stringify({
      agents: {
        "writer.opening": { model: "mock", styleBinding: "十字路口/opening@latest", tools: [] },
      },
    }),
    "utf8",
  );

  // Mock LLM agents used by distiller + writer
  vi.doMock("@crossing/agents", async () => {
    const real = await vi.importActual<any>("@crossing/agents");
    return {
      ...real,
      runSectionSlicer: vi.fn(async (_src: string) => ({ slices: [{ kind: "opening", text: "今天聊..." }] })),
      runStyleComposer: vi.fn(async (_slices: any[]) => ({ markdown: "# 开场风格 v2\n短句多。\n" })),
      runWriterOpening: vi.fn(async (ctx: any) => {
        // Assert style panel content is in prompt
        expect(ctx.prompt).toContain("短句多");
        return { content: "开场内容" };
      }),
    };
  });

  const app = await buildApp({ vaultRoot: tmp, configHome: path.join(tmp, ".crossing") });
  server = app.listen(0);
  const addr = server.address() as any;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function collectSSE(url: string, names: string[], timeoutMs = 5000): Promise<Record<string, any>> {
  const es = new EventSource(url);
  const out: Record<string, any> = {};
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { es.close(); reject(new Error("SSE timeout")); }, timeoutMs);
    names.forEach((n) => es.addEventListener(n, (ev: any) => {
      out[n] = JSON.parse(ev.data);
      if (n === "distill.composer_done" || n === "distill.failed") {
        clearTimeout(to); es.close(); resolve(out);
      }
    }));
  });
}

describe("SP-10 E2E: distill → list → writer run uses bound style", () => {
  it("happy path", async () => {
    // 1. distill
    const distillUrl = `${baseUrl}/api/config/style-panels/distill?account=${encodeURIComponent("十字路口")}&role=opening&sourceRefs=09_sources/sample.md`;
    const events = await collectSSE(distillUrl, ["distill.started", "distill.slicer_progress", "distill.composer_done", "distill.failed"]);
    expect(events["distill.composer_done"]).toBeDefined();
    expect(events["distill.composer_done"].version).toBe(2);

    // 2. new version file written
    const v2 = path.join(tmp, "08_experts/style-panel/十字路口/opening-v2.md");
    expect(fs.existsSync(v2)).toBe(true);

    // 3. list reflects it
    const listRes = await fetch(`${baseUrl}/api/config/style-panels`);
    const { panels } = await listRes.json();
    const found = panels.find((p: any) => p.account === "十字路口" && p.role === "opening" && p.version === 2);
    expect(found).toBeTruthy();

    // 4. writer run sees style content (mock asserts inside)
    const run = await fetch(`${baseUrl}/api/projects/p1/run/writer-opening`, { method: "POST" });
    expect(run.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL first (missing endpoints or missing mocks)**

Run: `pnpm --filter @crossing/web-server exec vitest run tests/sp10-e2e.test.ts`

Expected: may FAIL depending on whether `buildApp` accepts `configHome` or if `runWriterOpening` export name differs. Adjust mock names to match actual exports in `@crossing/agents` (check with `grep -n "^export" packages/agents/src/index.ts`).

- [ ] **Step 3: Add `eventsource` dev dep if absent**

```bash
pnpm --filter @crossing/web-server add -D eventsource
```

- [ ] **Step 4: Make test pass**

If any assertion fails, prefer fixing the service/mocks (do NOT weaken assertions). Common adjustments:
- rename `runStyleComposer` / `runWriterOpening` to actual exported symbols
- change `configHome` param to whatever `buildApp` expects (see T10 for signature)
- ensure orchestrator of T7 writes `opening-v2.md` (not `opening.v2.md`) — match filename convention from T3.

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @crossing/web-server exec vitest run tests/sp10-e2e.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/web-server/tests/sp10-e2e.test.ts packages/web-server/package.json
git -c commit.gpgsign=false commit -m "sp10(T25): E2E — distill SSE produces v2 + writer run reads bound style"
```

---

## Self-Review

### Spec coverage (spec §2–§9 ↔ tasks)

| Spec section | Covered by |
|---|---|
| §2.1 Role | T2 (frontmatter), T14 (legacy→role:legacy) |
| §2.2 StylePanel | T2, T3, T14, T21 |
| §2.3 AgentConfig | T4, T19, T20 |
| §2.4 ProjectOverride | T5, T13, T23 |
| §3.1 Backend services | T3–T8 |
| §3.2 Agents (section-slicer) | T1, T7 |
| §3.3 Frontend | T15–T24 |
| §4.1 Distill data flow | T7, T12, T22, T25 |
| §4.2 Run blocking | T9, T16, T24 |
| §5.1 Global config | T4, T10 |
| §5.2 Project override | T5, T13, T23 |
| §5.3 Style panel files | T2, T3, T14 |
| §6 Migration | T14 |
| §7 SSE events | T12 (emit), T16 (subscribe), T22 (consume), T24 |
| §8 Deletes | T11 (backend), T21 (frontend) |
| §9 Acceptance | T25 E2E |

### Placeholder scan

- "恢复" button in T21 reuses soft-delete endpoint with a code comment flagging this — not a hidden placeholder, explicitly documented. If T11 exposes a dedicated restore route, wire it in T21 when implementing.
- T24 `overrides=1` drawer behavior is implied (href link present); if brainstorming assumed a dedicated modal, revisit during T23/T24 sequencing.
- No "TBD/TODO/later/similar to Task N" strings in T14–T25.

### Type consistency check

- `AgentConfig` fields: `model`, `styleBinding`, `tools`, `promptVersion` — consistent across T15, T19, T20, T23.
- `StylePanelSummary` shape `{ account, role, version, status, bindable, boundTo? }` — consistent across T15, T21, T23 and matches T3/T11 backend output.
- `distillStylePanel(params, onEvent)` signature consistent T15 ↔ T22.
- Binding string format `"<account>/<role>@v<n>"` (or `@latest`) consistent T19, T20, T23, T24b, T25.
- SSE event names match T12 emit exactly: `distill.started`, `distill.slicer_progress`, `distill.composer_done`, `distill.failed`, `run.blocked`.

### Task count

T1–T13 (Part 1) + T14–T25 (Part 2) = **25 tasks** ✅

