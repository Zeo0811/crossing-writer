# SP-15 Distillation Acceleration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut single-article role-scoped distillation from ~5 min to < 3 min on first run and < 90s on re-runs, without sacrificing output quality. Three levers: (a) downgrade `section_slicer` default model to `claude-sonnet-4-5`, (b) run `snippets` and `structure` phases in parallel, (c) add a filesystem slicer cache keyed by `(model, body, prompt_hash)`.

**Architecture:** `AgentConfigStore` default factory registers `section_slicer` with sonnet-4.5 (user overrides via Config Workbench still win). `style-distill-role-orchestrator.ts` switches the snippets/structure awaits to `Promise.all`; composer still waits on both. A new `SlicerCache` helper in `packages/web-server/src/services/slicer-cache.ts` computes `sha256(model + body + prompt_hash)`, reads/writes `<vault>/08_experts/_cache/slicer/<key>.json` with atomic tmp+rename. The orchestrator consults the cache before invoking the slicer and emits a new `slicer_cache_hit` SSE event consumed by `useProjectStream` + `DistillModal`.

**Tech Stack:** TypeScript, Node 20 fs/promises + crypto, Vitest, React 19 (DistillModal). Existing SP-06/SP-08/SP-10 infrastructure: `AgentConfigStore`, `style-distill-role-orchestrator`, SSE route, `useProjectStream`.

---

## File Map

**Created:**
- `packages/web-server/src/services/slicer-cache.ts`
- `packages/web-server/tests/services/slicer-cache.test.ts`
- `packages/web-server/tests/services/style-distill-role-orchestrator.cache.test.ts`

**Modified:**
- `packages/agents/src/roles/section-slicer.ts` (default model)
- `packages/agents/tests/roles/section-slicer.test.ts`
- `packages/web-server/src/services/agent-config-store.ts` (default factory)
- `packages/web-server/tests/services/agent-config-store.test.ts`
- `packages/web-server/src/services/style-distill-role-orchestrator.ts` (parallel + cache)
- `packages/web-server/tests/services/style-distill-role-orchestrator.test.ts`
- `packages/web-server/src/routes/style-distill-stream.ts` (or whichever SSE route emits distill events)
- `packages/web-server/tests/routes/style-distill-stream.test.ts`
- `packages/web-ui/src/hooks/useProjectStream.ts` (EVENT_TYPES)
- `packages/web-ui/src/components/DistillModal.tsx` (cache-hit UI)
- `packages/web-ui/tests/hooks/use-project-stream.test.tsx`
- `packages/web-ui/tests/components/DistillModal.test.tsx`

---

## Task 1: Flip `section_slicer` default model to `claude-sonnet-4-5`

**Files:**
- Modify: `packages/agents/src/roles/section-slicer.ts`
- Test: `packages/agents/tests/roles/section-slicer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/tests/roles/section-slicer.test.ts
import { describe, it, expect } from "vitest";
import { sectionSlicerAgent } from "../../src/roles/section-slicer";

describe("section_slicer agent", () => {
  it("defaults to claude-sonnet-4-5 for speed on structural extraction", () => {
    expect(sectionSlicerAgent.defaultModel).toBe("claude-sonnet-4-5");
  });

  it("still declares the 'section_slicer' id so Config Workbench can override", () => {
    expect(sectionSlicerAgent.id).toBe("section_slicer");
  });
});
```

- [ ] **Step 2: Run — confirm red.**
- [ ] **Step 3: Implement** — update the exported `defaultModel` literal in `section-slicer.ts` from `"claude-opus-4-6"` to `"claude-sonnet-4-5"`. Leave prompt path unchanged.
- [ ] **Step 4: Run — confirm green.**
- [ ] **Step 5: Commit — `sp15(T1): default section_slicer to claude-sonnet-4-5`**

---

## Task 2: `AgentConfigStore` default factory registers slicer at sonnet

**Files:**
- Modify: `packages/web-server/src/services/agent-config-store.ts`
- Test: `packages/web-server/tests/services/agent-config-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web-server/tests/services/agent-config-store.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentConfigStore } from "../../src/services/agent-config-store";

describe("AgentConfigStore defaults — SP-15", () => {
  it("seeds section_slicer with sonnet-4.5 on a fresh vault", async () => {
    const vault = mkdtempSync(join(tmpdir(), "acs-"));
    const store = await createAgentConfigStore({ vaultRoot: vault });
    const resolved = store.resolve("section_slicer");
    expect(resolved.model).toBe("claude-sonnet-4-5");
    expect(resolved.cli).toBeDefined();
  });

  it("does not overwrite a user-customised slicer model on reload", async () => {
    const vault = mkdtempSync(join(tmpdir(), "acs-"));
    const store = await createAgentConfigStore({ vaultRoot: vault });
    await store.update("section_slicer", { model: "claude-opus-4-6" });
    const reopened = await createAgentConfigStore({ vaultRoot: vault });
    expect(reopened.resolve("section_slicer").model).toBe("claude-opus-4-6");
  });
});
```

- [ ] **Step 2: Run — confirm red.**
- [ ] **Step 3: Implement** — in the default factory, add/update the `section_slicer` entry with `model: "claude-sonnet-4-5"`. Ensure merge logic leaves user-set fields intact (silent migration only when model equals the old default `"claude-opus-4-6"` AND no `updated_by_user` flag).
- [ ] **Step 4: Run — confirm green.**
- [ ] **Step 5: Commit — `sp15(T2): seed section_slicer default to sonnet in AgentConfigStore`**

---

## Task 3: Parallelise snippets + structure in the role orchestrator

**Files:**
- Modify: `packages/web-server/src/services/style-distill-role-orchestrator.ts`
- Test: `packages/web-server/tests/services/style-distill-role-orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web-server/tests/services/style-distill-role-orchestrator.test.ts
import { describe, it, expect, vi } from "vitest";
import { runRoleDistill } from "../../src/services/style-distill-role-orchestrator";

describe("role orchestrator — SP-15 parallel phases", () => {
  it("kicks off snippets and structure concurrently once slicer is done", async () => {
    const order: string[] = [];
    const mark = (phase: string, delay: number) =>
      new Promise((r) => setTimeout(() => { order.push(phase); r({ phase }); }, delay));

    const fakeAgents = {
      runSlicer: vi.fn(async () => ({ slices: [{ role: "opinion", text: "x" }] })),
      runSnippets: vi.fn(async () => { order.push("snippets:start"); return mark("snippets:end", 40); }),
      runStructure: vi.fn(async () => { order.push("structure:start"); return mark("structure:end", 40); }),
      runComposer: vi.fn(async () => ({ profile: {} })),
    };

    await runRoleDistill({ article: { id: "a1", body: "b" }, agents: fakeAgents, emit: () => {} });

    // Both starts must appear before either end.
    const snippetsStart = order.indexOf("snippets:start");
    const structureStart = order.indexOf("structure:start");
    const firstEnd = Math.min(order.indexOf("snippets:end"), order.indexOf("structure:end"));
    expect(snippetsStart).toBeLessThan(firstEnd);
    expect(structureStart).toBeLessThan(firstEnd);
    expect(fakeAgents.runComposer).toHaveBeenCalledTimes(1);
  });

  it("propagates failure if either parallel phase rejects", async () => {
    const agents = {
      runSlicer: async () => ({ slices: [] }),
      runSnippets: async () => { throw new Error("snippet boom"); },
      runStructure: async () => ({ structure: {} }),
      runComposer: vi.fn(),
    };
    await expect(runRoleDistill({ article: { id: "a1", body: "b" }, agents, emit: () => {} }))
      .rejects.toThrow(/snippet boom/);
    expect(agents.runComposer).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — confirm red.**
- [ ] **Step 3: Implement** — replace sequential `await runSnippets(...); await runStructure(...);` with `const [snippets, structure] = await Promise.all([...]);`. Each branch still emits its own `snippets_done`/`structure_done` SSE event before resolving. Composer consumes both.
- [ ] **Step 4: Run — confirm green.**
- [ ] **Step 5: Commit — `sp15(T3): run snippets + structure phases with Promise.all`**

---

## Task 4: `SlicerCache` helper (fs-backed, atomic writes)

**Files:**
- Create: `packages/web-server/src/services/slicer-cache.ts`
- Test: `packages/web-server/tests/services/slicer-cache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web-server/tests/services/slicer-cache.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SlicerCache } from "../../src/services/slicer-cache";

describe("SlicerCache", () => {
  const freshVault = () => mkdtempSync(join(tmpdir(), "slicer-cache-"));

  it("computes a stable 16-char hex key from (model, body, promptHash)", () => {
    const cache = new SlicerCache({ vaultRoot: freshVault() });
    const k1 = cache.computeKey({ model: "claude-sonnet-4-5", body: "hello", promptHash: "abc" });
    const k2 = cache.computeKey({ model: "claude-sonnet-4-5", body: "hello", promptHash: "abc" });
    const k3 = cache.computeKey({ model: "claude-opus-4-6", body: "hello", promptHash: "abc" });
    expect(k1).toMatch(/^[a-f0-9]{16}$/);
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it("returns undefined on miss and persists on set under _cache/slicer", async () => {
    const vault = freshVault();
    const cache = new SlicerCache({ vaultRoot: vault });
    const key = cache.computeKey({ model: "m", body: "b", promptHash: "p" });
    expect(await cache.get(key)).toBeUndefined();

    await cache.set(key, { article_id: "a1", slices: [{ role: "quote", text: "q" }] });

    const files = readdirSync(join(vault, "08_experts", "_cache", "slicer"));
    expect(files).toContain(`${key}.json`);
    const roundTrip = await cache.get(key);
    expect(roundTrip?.slices?.[0]?.text).toBe("q");
  });

  it("writes atomically via tmp + rename (no partial file under the final name)", async () => {
    const vault = freshVault();
    const cache = new SlicerCache({ vaultRoot: vault });
    const key = cache.computeKey({ model: "m", body: "b", promptHash: "p" });
    await cache.set(key, { article_id: "a1", slices: [] });
    const dir = join(vault, "08_experts", "_cache", "slicer");
    const finals = readdirSync(dir).filter((f) => f.endsWith(".json"));
    const tmps = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(finals.length).toBe(1);
    expect(tmps.length).toBe(0);
    // Valid JSON
    JSON.parse(readFileSync(join(dir, finals[0]!), "utf8"));
  });
});
```

- [ ] **Step 2: Run — confirm red.**
- [ ] **Step 3: Implement** — `SlicerCache` class with:
  - ctor `{ vaultRoot }` (cache dir `08_experts/_cache/slicer`).
  - `computeKey({ model, body, promptHash })` → `createHash('sha256').update(model+'\n'+body+'\n'+promptHash).digest('hex').slice(0,16)`.
  - `get(key)` → `fs.readFile` + `JSON.parse`; return `undefined` on ENOENT or parse error.
  - `set(key, value)` → `mkdir -p`, write `<key>.json.tmp`, `rename` to `<key>.json`. Include `cached_at` timestamp and the passed metadata fields.
- [ ] **Step 4: Run — confirm green.**
- [ ] **Step 5: Commit — `sp15(T4): add SlicerCache with atomic fs writes`**

---

## Task 5: Hash slicer prompt bytes at module load

**Files:**
- Modify: `packages/web-server/src/services/slicer-cache.ts` (add `SLICER_PROMPT_HASH` export and helper)
- Test: `packages/web-server/tests/services/slicer-cache.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/web-server/tests/services/slicer-cache.test.ts
import { SLICER_PROMPT_HASH, computeSlicerPromptHash } from "../../src/services/slicer-cache";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

describe("slicer prompt hash", () => {
  it("is a 16-char hex sha256 prefix of the section-slicer prompt file", () => {
    expect(SLICER_PROMPT_HASH).toMatch(/^[a-f0-9]{16}$/);
  });

  it("matches a freshly computed hash of the same prompt bytes", () => {
    const promptPath = resolve(__dirname, "../../../agents/src/roles/prompts/section-slicer.md");
    const expected = createHash("sha256").update(readFileSync(promptPath)).digest("hex").slice(0, 16);
    expect(SLICER_PROMPT_HASH).toBe(expected);
    expect(computeSlicerPromptHash(promptPath)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run — confirm red.**
- [ ] **Step 3: Implement** — export `computeSlicerPromptHash(path)` and a module-level `SLICER_PROMPT_HASH` computed by calling it against the known prompt path (resolve via `import.meta.url` or a shared path constant). Cache the value in module scope.
- [ ] **Step 4: Run — confirm green.**
- [ ] **Step 5: Commit — `sp15(T5): precompute slicer prompt hash at module load`**

---

## Task 6: Wire `SlicerCache` into the orchestrator (hit + miss paths)

**Files:**
- Modify: `packages/web-server/src/services/style-distill-role-orchestrator.ts`
- Test: `packages/web-server/tests/services/style-distill-role-orchestrator.cache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web-server/tests/services/style-distill-role-orchestrator.cache.test.ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRoleDistill } from "../../src/services/style-distill-role-orchestrator";
import { SlicerCache, SLICER_PROMPT_HASH } from "../../src/services/slicer-cache";

describe("orchestrator cache integration — SP-15", () => {
  const baseAgents = () => ({
    runSlicer: vi.fn(async () => ({ slices: [{ role: "opinion", text: "o" }] })),
    runSnippets: vi.fn(async () => ({ snippets: [] })),
    runStructure: vi.fn(async () => ({ structure: {} })),
    runComposer: vi.fn(async () => ({ profile: {} })),
  });

  it("writes the slicer result to cache on a miss", async () => {
    const vault = mkdtempSync(join(tmpdir(), "orch-"));
    const cache = new SlicerCache({ vaultRoot: vault });
    const agents = baseAgents();
    const events: any[] = [];

    await runRoleDistill({
      article: { id: "a1", body: "body-1" },
      agents,
      cache,
      slicerModel: "claude-sonnet-4-5",
      emit: (e) => events.push(e),
    });

    expect(agents.runSlicer).toHaveBeenCalledTimes(1);
    const key = cache.computeKey({ model: "claude-sonnet-4-5", body: "body-1", promptHash: SLICER_PROMPT_HASH });
    expect(await cache.get(key)).toBeDefined();
    expect(events.some((e) => e.type === "slicer_cache_hit")).toBe(false);
  });

  it("short-circuits the slicer phase on a cache hit and emits slicer_cache_hit", async () => {
    const vault = mkdtempSync(join(tmpdir(), "orch-"));
    const cache = new SlicerCache({ vaultRoot: vault });
    const agents = baseAgents();
    const events: any[] = [];

    // Prime
    await runRoleDistill({ article: { id: "a1", body: "body-1" }, agents, cache,
      slicerModel: "claude-sonnet-4-5", emit: () => {} });
    agents.runSlicer.mockClear();

    await runRoleDistill({
      article: { id: "a1", body: "body-1" }, agents, cache,
      slicerModel: "claude-sonnet-4-5", emit: (e) => events.push(e),
    });

    expect(agents.runSlicer).not.toHaveBeenCalled();
    const hit = events.find((e) => e.type === "slicer_cache_hit");
    expect(hit).toBeDefined();
    expect(hit.article_id).toBe("a1");
    expect(hit.cache_key).toMatch(/^[a-f0-9]{16}$/);
  });
});
```

- [ ] **Step 2: Run — confirm red.**
- [ ] **Step 3: Implement** — orchestrator accepts an optional `cache: SlicerCache` + `slicerModel` (resolved from `AgentConfigStore`). Before slicer phase: compute `key`; if `get(key)` resolves, emit `slicer_cache_hit` and skip `runSlicer`. Otherwise run slicer and `cache.set(key, { article_id, slicer_model, slicer_prompt_hash, slices, cached_at })`. Write failures → `console.warn`, do not throw.
- [ ] **Step 4: Run — confirm green.** Also ensure Task 3 test still passes.
- [ ] **Step 5: Commit — `sp15(T6): integrate SlicerCache into role orchestrator`**

---

## Task 7: SSE route + frontend surface the cache hit

**Files:**
- Modify: `packages/web-server/src/routes/style-distill-stream.ts`
- Modify: `packages/web-ui/src/hooks/useProjectStream.ts`
- Modify: `packages/web-ui/src/components/DistillModal.tsx`
- Tests:
  - `packages/web-server/tests/routes/style-distill-stream.test.ts`
  - `packages/web-ui/tests/hooks/use-project-stream.test.tsx`
  - `packages/web-ui/tests/components/DistillModal.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/web-server/tests/routes/style-distill-stream.test.ts (addition)
it("forwards slicer_cache_hit events verbatim to SSE clients", async () => {
  const frames = await collectSseFrames(mockRequestWith({
    orchestratorEvents: [{ type: "slicer_cache_hit", article_id: "a1", cache_key: "deadbeefdeadbeef", cached_at: "2026-04-14T00:00:00Z" }],
  }));
  expect(frames).toContainEqual(expect.objectContaining({
    event: "slicer_cache_hit",
    data: expect.objectContaining({ article_id: "a1", cache_key: "deadbeefdeadbeef" }),
  }));
});
```

```tsx
// packages/web-ui/tests/hooks/use-project-stream.test.tsx (addition)
it("includes slicer_cache_hit in EVENT_TYPES and exposes the last event", () => {
  const { EVENT_TYPES } = require("../../src/hooks/useProjectStream");
  expect(EVENT_TYPES).toContain("slicer_cache_hit");
});
```

```tsx
// packages/web-ui/tests/components/DistillModal.test.tsx (addition)
it("shows a 'cached N' badge when slicer_cache_hit events arrive", () => {
  render(<DistillModal events={[
    { type: "slicer_cache_hit", article_id: "a1", cache_key: "x", cached_at: "" },
    { type: "slicer_cache_hit", article_id: "a2", cache_key: "y", cached_at: "" },
  ]} />);
  expect(screen.getByText(/cached 2/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — confirm red.**
- [ ] **Step 3: Implement**
  - Server: in the distill SSE route, whitelist `slicer_cache_hit` in the event passthrough table and forward `{ article_id, cache_key, cached_at }`.
  - `useProjectStream.ts`: add `"slicer_cache_hit"` to `EVENT_TYPES` array and to the typed `ProjectStreamEvent` union.
  - `DistillModal.tsx`: count incoming `slicer_cache_hit` events per run and render a `cached {n}` chip next to the slicer progress line. When the active article receives one, show `slicer — cached` instead of the spinner.
- [ ] **Step 4: Run — confirm green.**
- [ ] **Step 5: Commit — `sp15(T7): surface slicer_cache_hit on SSE and in DistillModal`**

---

## Task 8: End-to-end: re-running the same article skips the LLM via cache

**Files:**
- Test: `packages/web-server/tests/services/style-distill-role-orchestrator.cache.test.ts` (append an e2e-ish case)

- [ ] **Step 1: Write the failing test**

```ts
// append to style-distill-role-orchestrator.cache.test.ts
it("E2E: second run for the same article makes zero slicer LLM calls", async () => {
  const vault = mkdtempSync(join(tmpdir(), "e2e-"));
  const cache = new SlicerCache({ vaultRoot: vault });
  const agents = baseAgents();

  for (let i = 0; i < 2; i++) {
    await runRoleDistill({
      article: { id: "a-same", body: "identical body" },
      agents, cache,
      slicerModel: "claude-sonnet-4-5",
      emit: () => {},
    });
  }

  expect(agents.runSlicer).toHaveBeenCalledTimes(1); // only the first run
  expect(agents.runSnippets).toHaveBeenCalledTimes(2);
  expect(agents.runStructure).toHaveBeenCalledTimes(2);
  expect(agents.runComposer).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run — confirm red** (should already pass if T6 is done; if red, fix orchestrator wiring).
- [ ] **Step 3: Implement** — no new production code expected; tighten any flakiness (e.g., ensure cache writes await-flush before next run).
- [ ] **Step 4: Run — confirm green.**
- [ ] **Step 5: Commit — `sp15(T8): e2e verify slicer cache eliminates repeat LLM calls`**

---

## Task 9 (optional): CHANGELOG note

**Files:**
- Modify: `CHANGELOG.md` (if it exists at repo root)

- [ ] **Step 1:** If `CHANGELOG.md` exists, add under Unreleased:
  `SP-15: Distillation accelerated ~40% on first run (slicer on sonnet-4.5, snippets+structure parallel) and ~50% on repeat runs (slicer fs cache under 08_experts/_cache/slicer/).`
- [ ] **Step 2:** If no CHANGELOG exists, skip — do not create a new doc file.
- [ ] **Step 3: Commit (only if changed) — `sp15(T9): changelog note for distillation acceleration`**

---

## Self-Review

- **Spec coverage:** T1+T2 deliver default-model flip with user-override safety (spec §2). T3 delivers `Promise.all` (spec §3). T4+T5+T6+T8 deliver fs cache + prompt-hash + hit/miss paths (spec §4). T7 delivers `slicer_cache_hit` SSE + UI (spec §5). Acceptance bullets 1–6 are covered; 7 (end-to-end timing) is a manual measurement and documented in T9.
- **TDD discipline:** Every task has a failing test written first against a concrete public API (`sectionSlicerAgent.defaultModel`, `AgentConfigStore.resolve`, `SlicerCache.{get,set,computeKey}`, `runRoleDistill`, `EVENT_TYPES`, DOM output). No test asserts internal implementation details beyond call counts on injected fakes.
- **Risks / gaps:**
  - Exact import paths (e.g., `section-slicer.ts` location, SSE route filename, `DistillModal.tsx`) may differ — the executor should rg for the real paths and adjust; the goal of each task is stable.
  - `runRoleDistill` may today take a narrower argument object; Task 6 extends it with `{ cache, slicerModel }` — if existing callers (SSE route, tests) construct the arg inline, update them in the same commit.
  - Atomic rename on Windows can fail if the target exists; we overwrite so `rename` is fine on POSIX; Windows is out of scope for this vault tool.
  - Silent migration (spec §2.2) is only partial: T2 relies on `AgentConfigStore` default merge; if an existing vault already wrote `section_slicer.model = "claude-opus-4-6"` without an `updated_by_user` marker, we treat it as untouched and migrate. Executor should verify the marker convention matches SP-10's actual schema.
- **Out of scope (deferred):** composer acceleration, sqlite cache, LRU/TTL, snippets/structure caches, cross-article slicer reuse.
