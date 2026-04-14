# SP-12 Topic-Expert Team Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship backend + agent integration for topic-expert team. `TopicExpertStore` reads/writes `08_experts/topic-panel/index.yaml` + per-expert KB files; extend `topic-expert.ts` agent with `invokeType` switch (round1=score / round2=structure / round3=continue); expose CRUD routes + SSE consult orchestrator (parallel concurrency=3, fail-isolated); wire into server.ts.

**Architecture:** `TopicExpertStore` (services) → fastify routes under `/api/topic-experts` + `/api/projects/:id/topic-experts/consult` (SSE) → orchestrator `runTopicExpertConsult` parallel-maps selected experts through `TopicExpert` agent. Reuse SP-01 vault writer, SP-06 distill pipeline, SP-10 SSE pattern (`reply.hijack()` + `writeHead(200)` + `flushHeaders()`).

**Tech Stack:** Fastify, vitest, @crossing/kb, @crossing/agents, js-yaml, gray-matter.

---

## T1 — `TopicExpertStore` service

**Files:**
- Create: `packages/web-server/src/services/topic-expert-store.ts`
- Test: `packages/web-server/tests/topic-expert-store.test.ts`

**Steps:**
1. [ ] Define types:
   ```ts
   export interface TopicExpertMeta {
     name: string;
     specialty: string;
     active: boolean;
     default_preselect: boolean;
     soft_deleted: boolean;
     updated_at?: string;
     distilled_at?: string;
     version?: number;
   }
   export interface TopicExpertDetail extends TopicExpertMeta {
     kb_markdown: string;
     word_count: number;
   }
   ```
2. [ ] Constructor `new TopicExpertStore(vaultRoot: string)`. Resolve `panelDir = join(vaultRoot, "08_experts/topic-panel")`, `indexPath = join(panelDir, "index.yaml")`, `expertsDir = join(panelDir, "experts")`, `trashDir = join(panelDir, ".trash")`.
3. [ ] Private `readIndex(): { version: number; updated_at: string; experts: TopicExpertMeta[] }`: if file missing, bootstrap by scanning `experts/*_kb.md` filenames, parsing frontmatter via `gray-matter`, seeding `active:true, default_preselect:false, soft_deleted:false`.
4. [ ] Private `writeIndex(idx)`: yaml.dump + fs.writeFile + call injected `vaultCommit(message)` (accept optional `commit?: (msg:string)=>Promise<void>` in constructor for testability).
5. [ ] `async list(): Promise<TopicExpertMeta[]>` — return `readIndex().experts`.
6. [ ] `async get(name: string): Promise<TopicExpertDetail | null>` — find meta; read `experts/<name>_kb.md` via gray-matter; merge frontmatter fields into meta; compute `word_count = body.length`; return with `kb_markdown: body`; null if missing or `soft_deleted`.
7. [ ] `async set(name: string, patch: Partial<Pick<TopicExpertMeta,"active"|"default_preselect"|"specialty">>): Promise<TopicExpertMeta>` — mutate index entry + update `updated_at`, writeIndex, commit "topic-expert: update <name>". Throw `Error("expert not found")` if missing.
8. [ ] `async writeKb(name: string, body: string, frontmatterPatch?: Record<string,unknown>): Promise<void>` — merge old frontmatter with patch; gray-matter stringify; fs.writeFile; commit "topic-expert: kb <name>".
9. [ ] `async create(name: string, specialty: string): Promise<TopicExpertMeta>` — refuse if duplicate (case-insensitive); append entry to index with `active:false, default_preselect:false, soft_deleted:false`; write empty KB md with frontmatter stub; commit "topic-expert: create <name>".
10. [ ] `async softDelete(name: string): Promise<void>` — set `soft_deleted:true`, writeIndex, commit "topic-expert: soft-delete <name>".
11. [ ] `async hardDelete(name: string): Promise<void>` — remove entry from index; move `<name>_kb.md` to `.trash/<name>_kb.<ts>.md`; writeIndex; commit "topic-expert: hard-delete <name>".
12. [ ] Tests (vitest, tmp vault via `fs.mkdtempSync`):
    - bootstrap empty index from two seeded `_kb.md` files
    - `list()` reflects index entries
    - `get()` returns merged detail + word_count; returns null for soft_deleted
    - `set()` persists active toggle + specialty edit
    - `writeKb()` preserves frontmatter
    - `create()` duplicate throws
    - `softDelete()` hides from `get()`
    - `hardDelete()` moves file to `.trash` and removes from index
    - all mutations invoke the injected `commit` spy

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/topic-expert-store.test.ts`

---

## T2 — `topic-expert.ts` agent `invokeType` extension

**Files:**
- Create: `packages/agents/src/prompts/topic-expert-round3.md` (continue-writing prompt)
- Modify: `packages/agents/src/roles/topic-expert.ts`
- Modify: `packages/agents/src/index.ts` (export `runTopicExpertConsult` helper signature if absent)
- Test: `packages/agents/tests/topic-expert.test.ts`

**Steps:**
1. [ ] Write `topic-expert-round3.md`: system prompt reads `{{expert_name}} / {{kb_content}}`; user prompt receives `{{current_draft}}` + `{{focus}}`; instructs agent to continue the draft in the expert's voice for ~200-400 chars, returning markdown only.
2. [ ] Inspect existing `topic-expert.ts` — it currently exposes `round1(input)` and `round2(input)` methods. Add:
   ```ts
   export interface Round3Input {
     projectId: string;
     runId: string;
     currentDraft: string;
     focus?: string;
   }
   round3(input: Round3Input) { /* load topic-expert-round3, merge baseVars + input, invoke via AgentBase */ }
   ```
3. [ ] Add high-level helper:
   ```ts
   export type TopicExpertInvokeType = "score" | "structure" | "continue";
   export async function invokeTopicExpert(args: {
     name: string;
     kbContent: string;
     kbSource: string;
     cli: "claude"|"codex";
     model?: string;
     invokeType: TopicExpertInvokeType;
     projectId: string;
     runId: string;
     briefSummary?: string;
     refsPack?: string;
     candidatesMd?: string;
     currentDraft?: string;
     focus?: string;
   }): Promise<{ markdown: string; meta: { cli: string; model?: string|null; durationMs: number } }>
   ```
   that constructs a `TopicExpert`, dispatches based on `invokeType`, and validates required fields per round (throw on missing).
4. [ ] Re-export `invokeTopicExpert` + `TopicExpertInvokeType` + `Round3Input` from `packages/agents/src/index.ts`.
5. [ ] Tests (mock `../src/model-adapter.js` `invokeAgent`):
   - score path: passes `briefSummary + refsPack` through, throws if missing
   - structure path: requires `candidatesMd`
   - continue path: requires `currentDraft`; prompt includes focus when provided
   - returns `{ markdown, meta }` pass-through shape

**Verify:** `pnpm --filter @crossing/agents exec vitest run tests/topic-expert.test.ts`

---

## T3 — Read / update routes

**Files:**
- Create: `packages/web-server/src/routes/topic-experts.ts`
- Test: `packages/web-server/tests/topic-experts-read.test.ts`

**Steps:**
1. [ ] Fastify plugin `topicExpertsRoutes(fastify, opts: { store: TopicExpertStore })`.
2. [ ] `GET /api/topic-experts` → `{ experts: (await store.list()).filter(e => !e.soft_deleted || includeSoftDeleted) }`. Accept `?include_deleted=1` query.
3. [ ] `GET /api/topic-experts/:name` → detail; 404 when `null`.
4. [ ] `PUT /api/topic-experts/:name` → body schema `{ active?, default_preselect?, specialty?, kb_markdown? }`. If `kb_markdown` present, call `store.writeKb`. Always call `store.set` for scalar patch fields. Return `{ ok:true, expert }`.
5. [ ] Tests (build fastify instance with in-memory tmp vault + seeded store):
    - list returns seeded entries (2 experts)
    - list hides soft_deleted unless query set
    - get returns 404 for unknown
    - put toggles `active`, verifies via subsequent get
    - put with `kb_markdown` writes body

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/topic-experts-read.test.ts`

---

## T4 — Create / delete routes

**Files:**
- Modify: `packages/web-server/src/routes/topic-experts.ts`
- Test: `packages/web-server/tests/topic-experts-write.test.ts`

**Steps:**
1. [ ] `POST /api/topic-experts` → body `{ name: string; specialty: string; seed_urls?: string[] }`. Call `store.create(name, specialty)`. If `seed_urls` provided, log "TODO distill pipeline" and return `{ ok:true, expert, job_id: null }` (real distill kick-off deferred to T8). Return 409 when duplicate.
2. [ ] `DELETE /api/topic-experts/:name` → read `?mode=soft|hard` query (default `soft`). Call `softDelete` or `hardDelete` accordingly. Return `{ ok:true, mode }`.
3. [ ] Also accept `?hard=1` as alias (spec in ticket) → treat as `mode=hard`.
4. [ ] Tests:
    - POST creates new expert; appears in list
    - POST duplicate → 409
    - DELETE default → soft-delete, list hides it
    - DELETE `?mode=hard` → file moved to `.trash`, index no longer has entry
    - DELETE `?hard=1` alias behaves same as `mode=hard`

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/topic-experts-write.test.ts`

---

## T5 — `runTopicExpertConsult` orchestrator

**Files:**
- Create: `packages/web-server/src/services/topic-expert-consult.ts`
- Test: `packages/web-server/tests/topic-expert-consult.test.ts`

**Steps:**
1. [ ] Signature:
   ```ts
   export interface ConsultEvent {
     type: "topic_consult.started"|"expert_started"|"expert_delta"
          |"expert_done"|"expert_failed"|"all_done";
     data: Record<string, unknown>;
   }
   export interface ConsultArgs {
     projectId: string;
     selectedExperts: string[];
     invokeType: TopicExpertInvokeType;
     brief?: string;
     productContext?: string;
     candidatesMd?: string;
     currentDraft?: string;
     focus?: string;
     cli?: "claude"|"codex";
     model?: string;
   }
   export async function runTopicExpertConsult(
     args: ConsultArgs,
     deps: {
       store: TopicExpertStore;
       invoke: typeof invokeTopicExpert;
       emit: (ev: ConsultEvent) => void;
       concurrency?: number;
     }
   ): Promise<{ succeeded: string[]; failed: string[] }>
   ```
2. [ ] Emit `topic_consult.started` with `{ invokeType, selected }`.
3. [ ] Concurrency gate (default 3): simple promise-pool pattern — maintain an `active` set, iterate selected names, `await Promise.race(active)` when size >= limit.
4. [ ] For each expert: emit `expert_started`; `await store.get(name)` — if null, emit `expert_failed` with `error:"kb not found"` and continue.
5. [ ] Build invoke args mapping `invokeType` → required fields (score: brief+productContext as `briefSummary/refsPack`; structure: `candidatesMd`; continue: `currentDraft + focus`). Call `deps.invoke({...})`.
6. [ ] On success emit `expert_done` with `{ name, markdown, tokens: null, meta }`. Push to `succeeded`.
7. [ ] On throw emit `expert_failed` with `{ name, error: err.message }`. Push to `failed`.
8. [ ] After all settle, emit `all_done` with `{ succeeded, failed }`; return the same.
9. [ ] Fail-isolated: one rejection never cancels others.
10. [ ] Tests (mock `invoke` + `store.get`):
     - 3 experts all succeed → 5 events in order: started, 3×started, 3×done, all_done (ordering asserted loosely: started first, all_done last)
     - 1 missing KB → `expert_failed` with `kb not found`; others succeed
     - concurrency=2 with 5 experts: at no point more than 2 in-flight (assert via a counter in mocked invoke)
     - invoke throws for one name → `expert_failed`, others proceed
     - `all_done.data.succeeded + failed` contains every selected name exactly once

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/topic-expert-consult.test.ts`

---

## T6 — SSE consult route

**Files:**
- Create: `packages/web-server/src/routes/topic-expert-consult.ts`
- Test: `packages/web-server/tests/topic-expert-consult-route.test.ts`

**Steps:**
1. [ ] Fastify plugin signature `topicExpertConsultRoutes(fastify, opts: { store; invoke })`.
2. [ ] `POST /api/projects/:id/topic-experts/consult` body `{ selected: string[]; invokeType: "score"|"structure"|"continue"; brief?, productContext?, candidatesMd?, currentDraft?, focus? }`.
3. [ ] Validate body: 400 when `selected` empty or `invokeType` invalid.
4. [ ] SSE setup (copy from SP-10 / SP-11 pattern):
   ```ts
   reply.hijack();
   reply.raw.writeHead(200, {
     "content-type": "text/event-stream",
     "cache-control": "no-cache, no-transform",
     connection: "keep-alive",
     "x-accel-buffering": "no",
   });
   (reply.raw as any).flushHeaders?.();
   const emit = (ev: ConsultEvent) => {
     reply.raw.write(`event: ${ev.type}\n`);
     reply.raw.write(`data: ${JSON.stringify(ev.data)}\n\n`);
   };
   ```
5. [ ] Call `runTopicExpertConsult({ projectId: req.params.id, ...body }, { store, invoke, emit })`. Wrap in try/catch → on fatal error emit a synthetic `expert_failed` + `all_done` before `reply.raw.end()`.
6. [ ] Always `reply.raw.end()` in a finally.
7. [ ] Tests: build fastify instance, inject with `payload` + use `res.rawPayload` to parse SSE stream lines:
    - 2-expert happy path: asserts events contain `topic_consult.started`, 2× `expert_done`, `all_done`
    - empty `selected` → 400, no SSE
    - invalid `invokeType` → 400
    - one expert fails in mocked invoke → stream still emits `all_done`, HTTP 200

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/topic-expert-consult-route.test.ts`

---

## T7 — Register routes + boot test

**Files:**
- Modify: `packages/web-server/src/server.ts` (register new plugins, wire `TopicExpertStore` + `invokeTopicExpert`)
- Test: `packages/web-server/tests/topic-experts-boot.test.ts`

**Steps:**
1. [ ] In `buildServer` (or equivalent bootstrap): construct `const topicExpertStore = new TopicExpertStore(vaultRoot, { commit: vaultCommit })`.
2. [ ] Register `topicExpertsRoutes` with `{ store: topicExpertStore }`.
3. [ ] Register `topicExpertConsultRoutes` with `{ store: topicExpertStore, invoke: invokeTopicExpert }`.
4. [ ] Boot test: start fastify on ephemeral port, assert:
    - `GET /api/topic-experts` returns 200 with `{ experts: [] }` (empty vault)
    - `POST /api/topic-experts` with `{ name:"test", specialty:"x" }` returns 200 and subsequent list has one entry
    - `POST /api/projects/p1/topic-experts/consult` with empty selected → 400
5. [ ] Ensure no regression in other route tests (run existing suite).

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/topic-experts-boot.test.ts`

---

## T8 — Topic-expert re-distill route (stub + TODO handoff)

**Files:**
- Modify: `packages/web-server/src/routes/topic-experts.ts`
- Test: `packages/web-server/tests/topic-experts-distill.test.ts`

**Steps:**
1. [ ] `POST /api/topic-experts/:name/distill` → body `{ seed_urls?: string[]; mode?: "initial"|"redistill" }`.
2. [ ] For this task, wire a **thin adapter** that:
   - Verifies the expert exists in the store (404 if not).
   - Reads current KB (if any) into `.bak/<name>_kb.<ts>.md` via store helper (add `backupKb(name)` method to T1 store if missing, otherwise inline here).
   - Returns `202 { job_id: <uuid>, status: "queued" }`. **Actual distill pipeline integration (SP-06 + SP-07 reuse) is marked TODO and deferred to T9 of part 2.**
3. [ ] Emit `console.info("[topic-expert] distill queued", { name, mode, job_id })` placeholder until the pipeline worker lands.
4. [ ] Tests:
    - 404 on unknown expert
    - 202 on known expert; `.bak` file present when prior KB exists
    - `.bak` skipped when KB body empty (initial case)
    - Response shape: `{ job_id, status:"queued" }`

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/topic-experts-distill.test.ts`

**Open questions / carried forward to Part 2:**
- Actual distill pipeline wiring (wiki-ingestor → style-distiller → store.writeKb + `version++`) — **T9 Part 2**.
- Config Workbench UI panel (`🧑‍🎓 选题专家团`) + DistillModal reuse — **T10+ Part 2**.
- Project page `[🗂 召唤选题专家团]` SSE client + streaming cards — **T10+ Part 2**.

<!-- PART2_MARKER -->
