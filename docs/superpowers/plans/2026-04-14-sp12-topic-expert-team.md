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

## T9 — Topic-expert full distill pipeline

**Files:**
- Create: `packages/web-server/src/services/topic-expert-distill.ts`
- Modify: `packages/web-server/src/routes/topic-experts.ts` (upgrade T8 stub)
- Test: `packages/web-server/tests/topic-expert-distill-pipeline.test.ts`

**Steps:**
1. [ ] Signature:
   ```ts
   export interface DistillArgs {
     expertName: string;
     seedUrls?: string[];
     mode: "initial"|"redistill";
     cli?: "claude"|"codex";
     model?: string;
   }
   export interface DistillEvent {
     type: "distill.started"|"ingest_progress"|"distill_progress"
          |"distill.done"|"distill.failed";
     data: Record<string, unknown>;
   }
   export async function runTopicExpertDistill(
     args: DistillArgs,
     deps: {
       store: TopicExpertStore;
       ingest: (urls: string[]) => Promise<{ articles: Array<{ url:string; title:string; body:string }> }>;
       distill: (input: { name:string; articles: unknown[]; cli:string; model?:string }) => Promise<{ markdown:string; version:number }>;
       emit: (ev: DistillEvent) => void;
     }
   ): Promise<{ version: number; backupPath?: string }>
   ```
2. [ ] Emit `distill.started` with `{ expertName, mode, seedCount }`.
3. [ ] Resolve expert via `store.get(name)` → 404 throw if missing.
4. [ ] If `mode==="redistill"` and existing KB body non-empty, call `store.backupKb(name)` → record `.bak/<name>_kb.<ts>.md` path.
5. [ ] Call `deps.ingest(seedUrls ?? [])` — wraps SP-07 wiki-ingestor; emit `ingest_progress` per article (`{ url, title }`).
6. [ ] Call `deps.distill({ name, articles, cli, model })` — wraps SP-06 style-distiller; emit `distill_progress` events forwarded from distiller stream.
7. [ ] On success call `store.writeKb(name, markdown, { distilled_from: seedUrls, distilled_at: new Date().toISOString(), version: (prev.version ?? 0) + 1 })`; commit "topic-expert: distill <name> v<n>".
8. [ ] Emit `distill.done` with `{ expertName, version, backupPath }`.
9. [ ] On any throw emit `distill.failed` with `{ error: err.message }` and rethrow.
10. [ ] Upgrade route: `POST /api/topic-experts/:name/distill` → SSE (hijack pattern as T6). Body `{ seed_urls?, mode? }`. Invoke `runTopicExpertDistill` with real `ingest`/`distill` deps imported from `@crossing/agents`.
11. [ ] Tests (mock ingest + distill):
    - initial mode: no backup; emits started → ingest_progress × N → distill.done with version=1
    - redistill mode: backup path returned; version increments
    - ingest throws → emits `distill.failed`; route responds 200 SSE with failure event
    - SSE route: 2-url seed, assert events in order on `res.rawPayload`

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/topic-expert-distill-pipeline.test.ts`

---

## T10 — Frontend client API

**Files:**
- Modify: `packages/web-ui/src/api/writer-client.ts`
- Test: `packages/web-ui/tests/writer-client.topic-experts.test.ts`

**Steps:**
1. [ ] Add TypeScript types mirroring backend:
   ```ts
   export interface TopicExpertMeta { name:string; specialty:string; active:boolean; default_preselect:boolean; soft_deleted:boolean; updated_at?:string; distilled_at?:string; version?:number }
   export interface TopicExpertDetail extends TopicExpertMeta { kb_markdown:string; word_count:number }
   export type TopicExpertInvokeType = "score"|"structure"|"continue";
   ```
2. [ ] Plain REST methods:
   ```ts
   listTopicExperts(opts?: { includeDeleted?: boolean }): Promise<{ experts: TopicExpertMeta[] }>
   getTopicExpert(name: string): Promise<TopicExpertDetail>
   setTopicExpert(name: string, patch: Partial<Pick<TopicExpertMeta,"active"|"default_preselect"|"specialty"> & { kb_markdown?: string }>): Promise<{ ok:true; expert: TopicExpertMeta }>
   createTopicExpert(body: { name:string; specialty:string; seed_urls?: string[] }): Promise<{ ok:true; expert: TopicExpertMeta; job_id: string|null }>
   deleteTopicExpert(name: string, opts?: { mode?: "soft"|"hard" }): Promise<{ ok:true; mode:"soft"|"hard" }>
   ```
3. [ ] SSE methods reuse existing `openSse(url, body, handlers)` helper:
   ```ts
   distillTopicExpert(name: string, body: { seed_urls?: string[]; mode?: "initial"|"redistill" }, handlers: { onEvent: (type:string, data:unknown)=>void; onError?: (e:Error)=>void; onClose?: ()=>void }): { abort: ()=>void }
   consultTopicExperts(projectId: string, body: { selected: string[]; invokeType: TopicExpertInvokeType; brief?:string; productContext?:string; candidatesMd?:string; currentDraft?:string; focus?:string }, handlers: { onEvent: (type:string, data:unknown)=>void; onError?:(e:Error)=>void; onClose?:()=>void }): { abort: ()=>void }
   ```
4. [ ] Tests (`vi.fn` for fetch + `EventSource` polyfill as in existing client tests):
    - `listTopicExperts` hits `GET /api/topic-experts`; `includeDeleted:true` adds `?include_deleted=1`
    - `getTopicExpert` hits `GET /api/topic-experts/foo`; 404 rejects
    - `setTopicExpert` PUTs JSON body
    - `createTopicExpert` POSTs body; propagates 409 error
    - `deleteTopicExpert` default → `?mode=soft`; `{mode:"hard"}` → `?mode=hard`
    - `distillTopicExpert` + `consultTopicExperts`: assert SSE handler fires `onEvent` per parsed event; `abort()` closes source

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run tests/writer-client.topic-experts.test.ts`

---

## T11 — `useProjectStream` event type extension

**Files:**
- Modify: `packages/web-ui/src/hooks/useProjectStream.ts` (or equivalent)
- Test: `packages/web-ui/tests/useProjectStream.topic-consult.test.ts`

**Steps:**
1. [ ] Extend `EVENT_TYPES` union / const array to include: `topic_consult.started`, `expert_started`, `expert_delta`, `expert_done`, `expert_failed`, `all_done`.
2. [ ] Add typed payload interfaces:
   ```ts
   export interface ExpertStartedPayload { name: string }
   export interface ExpertDeltaPayload { name: string; chunk: string }
   export interface ExpertDonePayload { name: string; markdown: string; tokens?: number|null; meta?: { cli:string; model?:string|null; durationMs:number } }
   export interface ExpertFailedPayload { name: string; error: string }
   export interface TopicConsultStartedPayload { invokeType: TopicExpertInvokeType; selected: string[] }
   export interface AllDonePayload { succeeded: string[]; failed: string[] }
   ```
3. [ ] State slice: add `topicConsult` shape `{ status: "idle"|"running"|"done"; invokeType?: TopicExpertInvokeType; experts: Record<string, { status:"pending"|"running"|"done"|"failed"; markdown:string; error?:string }>; succeeded: string[]; failed: string[] }`.
4. [ ] Reducer handles each event: started seeds entries → pending; `expert_started` → running; `expert_delta` → appends chunk; `expert_done` → done + final markdown; `expert_failed` → failed + error; `all_done` → status:"done" + summary.
5. [ ] Tests:
    - dispatches each new event type, asserts reducer shape
    - `expert_delta` accumulates across multiple chunks
    - `expert_failed` does not unset other experts' state
    - `all_done` transitions `status` to `"done"` and records both arrays

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run tests/useProjectStream.topic-consult.test.ts`

---

## T12 — Config Workbench side nav + `TopicExpertPanel`

**Files:**
- Modify: `packages/web-ui/src/pages/ConfigWorkbench.tsx` (add nav entry)
- Create: `packages/web-ui/src/components/config/TopicExpertPanel.tsx`
- Create: `packages/web-ui/src/components/config/TopicExpertRow.tsx`
- Create: `packages/web-ui/src/components/config/NewTopicExpertModal.tsx`
- Test: `packages/web-ui/tests/TopicExpertPanel.test.tsx`

**Steps:**
1. [ ] Add side-nav item `{ key: "topic-experts", label: "🧑‍🎓 选题专家团" }` to ConfigWorkbench, route it to `<TopicExpertPanel />`.
2. [ ] `TopicExpertPanel`:
    - on mount call `client.listTopicExperts()`, render table (columns: name / specialty / active toggle / default_preselect toggle / distilled_at / 操作)
    - 操作 column: `[查看KB] [重蒸] [软删] [硬删] [新增]` (新增 at panel top-right).
    - `active` / `default_preselect` toggles → `client.setTopicExpert` + optimistic update; rollback on error (toast).
    - specialty cell: inline edit (double-click → textarea), blur → setTopicExpert.
    - `[查看KB]` → side drawer renders `kb_markdown` via existing `<Markdown>` component.
    - `[重蒸]` → opens `DistillModal` (reuse SP-10) with `mode="redistill"`, wired to `client.distillTopicExpert(name, { mode:"redistill" }, handlers)`; show live SSE events in modal body.
    - `[软删]` → confirm dialog → `deleteTopicExpert(name, { mode:"soft" })`; row greyed.
    - `[硬删]` → stricter confirm (typed name) → `deleteTopicExpert(name, { mode:"hard" })`; row removed.
    - `[+ 新增专家]` → `NewTopicExpertModal` (name + specialty + optional seed_urls textarea); submit → `createTopicExpert` then optionally chain `distillTopicExpert(name, { mode:"initial", seed_urls })` if URLs provided.
3. [ ] Empty / loading / error states.
4. [ ] Tests (`@testing-library/react` + msw or fetch mocks):
    - renders two seeded experts after mount
    - toggling `active` fires `PUT` with `{active:false}`
    - soft-delete hides row after refresh
    - hard-delete confirmation requires typed name
    - new-expert modal POSTs create + (if URLs) triggers distill SSE
    - reshow loading spinner during distill events, success final state

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run tests/TopicExpertPanel.test.tsx`

---

## T13 — `TopicExpertConsultModal`

**Files:**
- Create: `packages/web-ui/src/components/project/TopicExpertConsultModal.tsx`
- Create: `packages/web-ui/src/components/project/ExpertStreamCard.tsx`
- Test: `packages/web-ui/tests/TopicExpertConsultModal.test.tsx`

**Steps:**
1. [ ] Props:
   ```ts
   interface Props {
     projectId: string;
     briefSummary?: string;
     productContext?: string;
     candidatesMd?: string;
     currentDraft?: string;
     open: boolean;
     onClose: () => void;
     onSaved?: (markdown: string) => void;
   }
   ```
2. [ ] On open, `client.listTopicExperts()` → filter `active && !soft_deleted`. Default-checked set = those with `default_preselect:true`.
3. [ ] Top area: segmented control for invokeType `[打分 | 结构 | 续写]` (values `score`/`structure`/`continue`).
4. [ ] Body: checkbox list, each row `[✓] <name> — <specialty>`.
5. [ ] Footer: `[开始召唤]` disabled when `selected.length===0`. Secondary `[取消]`.
6. [ ] Submit → call `client.consultTopicExperts(projectId, { selected, invokeType, brief, productContext, candidatesMd, currentDraft }, handlers)`. Handlers wire into local reducer (reuse shape from T11).
7. [ ] Live view: replace config area with progress banner `N / M 专家已完成` + grid of `<ExpertStreamCard name status markdown error onRetry>` (markdown rendered with existing `<StreamingMarkdownCard>` or similar).
8. [ ] Failed card shows `[重试]` → re-invokes consult for that single expert (re-opens SSE with `selected:[name]`).
9. [ ] After `all_done`: button `[保存到项目笔记]` → concats all succeeded markdown with headers `## <name>`, calls `onSaved(combined)` (caller writes to project note; see T14).
10. [ ] Tests:
    - defaults preselects experts with `default_preselect:true`
    - invokeType `score` is default
    - submit triggers SSE with correct payload
    - `expert_delta` appends to card markdown progressively
    - `expert_failed` card shows retry; clicking retry re-opens SSE
    - `[保存到项目笔记]` emits combined markdown via `onSaved`

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run tests/TopicExpertConsultModal.test.tsx`

---

## T14 — Integrate consult modal into `ProjectWorkbench`

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx`
- Test: `packages/web-ui/tests/ProjectWorkbench.topic-expert-button.test.tsx`

**Steps:**
1. [ ] In Step 1 (brief 解析后) area, add button `[🗂 召唤选题专家团]`. Disabled until `briefSummary` exists.
2. [ ] Local state `consultModalOpen: boolean`; button onClick → open; pass current `projectId / briefSummary / productContext / candidatesMd / currentDraft` as props.
3. [ ] `onSaved(markdown)` handler: PUT to vault `projects/<id>/topic-expert-panel.md` via existing project-notes client method (or add `saveProjectNote(projectId, relPath, markdown)` helper if missing). Toast "已保存到项目笔记".
4. [ ] Tests:
    - button disabled pre-brief
    - enables once brief exists
    - clicking opens modal (presence of modal role)
    - onSaved callback invokes `saveProjectNote` with `topic-expert-panel.md` path

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run tests/ProjectWorkbench.topic-expert-button.test.tsx`

---

## T15 — E2E: mocked backend SSE consult

**Files:**
- Create: `packages/web-ui/tests/e2e/topic-expert-consult.e2e.test.tsx`
- Test helper (if absent): `packages/web-ui/tests/e2e/helpers/mock-sse-server.ts`

**Steps:**
1. [ ] Spin up an in-process mock server (e.g., `msw` with SSE extension or a local `http.createServer`) that:
    - `GET /api/topic-experts` → returns 3 active experts `[A,B,C]`, two `default_preselect:true` (A,B).
    - `POST /api/projects/p1/topic-experts/consult` → replies `text/event-stream`; writes `topic_consult.started`, `expert_started` for each selected, 2× `expert_delta` chunks each, `expert_done` each, `all_done`.
2. [ ] Render `<ProjectWorkbench projectId="p1" />` with seeded brief context.
3. [ ] Click `[🗂 召唤选题专家团]` → modal appears.
4. [ ] Assert default-checked experts are `[A,B]`; select invokeType `打分` (default).
5. [ ] Click `[开始召唤]`.
6. [ ] Await: both `<ExpertStreamCard name="A">` and `<ExpertStreamCard name="B">` render final markdown (`getByText` on streamed content).
7. [ ] Progress indicator reads `2 / 2 专家已完成`.
8. [ ] `[保存到项目笔记]` button visible and clicking calls mocked save endpoint once.
9. [ ] Negative variant test: server emits `expert_failed` for B → card shows error + `[重试]`.
10. [ ] Tests run under vitest `environment: "jsdom"` with real `EventSource` polyfill.

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run tests/e2e/topic-expert-consult.e2e.test.tsx`

---

## Self-Review

**Spec coverage (T1-T15 vs spec §3-§9):**
- §3.1 `TopicExpertStore` — T1
- §3.2 orchestrator (parallel, concurrency=3, fail-isolated) — T5
- §3.3 agent `invokeType` switch — T2
- §4.1 list — T3
- §4.2 detail — T3
- §4.3 update — T3
- §4.4 create — T4
- §4.5 delete (soft/hard) — T4
- §4.6 SSE consult — T6
- §5.1/5.2 index.yaml + frontmatter — T1
- §6.1 Config Workbench 侧栏 — T12
- §6.2 Project Page Step 1 召唤 — T13 + T14
- §6.3 SSE 流式卡片 — T13 (`ExpertStreamCard`)
- §7 蒸馏/重蒸/新增/软硬删 管线 — T9 (pipeline) + T12 (UI wiring)
- §8 SSE 事件名 (`topic_consult.started / expert_started / expert_delta / expert_done / expert_failed / all_done`) — T11 + T13
- §9 验收 10 项 — covered by T6+T13 happy path, T4 软硬删, T9 重蒸 version++/.bak, T13 default_preselect 勾选, T13 invokeType 三种, T5 fail-isolated, T14 `[保存到项目笔记]`.

**Placeholder scan:** grep for `<!-- PART2_MARKER -->` → removed. No `TODO(placeholder)` / `FIXME` / `???` left in plan body besides T9 which is the resolution of T8's forward TODO.

**Type consistency:** `TopicExpertMeta` / `TopicExpertDetail` / `TopicExpertInvokeType` defined once in T1, mirrored verbatim in T10, reused in T11/T13. Event names in T11 match T5 orchestrator emits (T5 emits `expert_delta` in SP-spec §8 though orchestrator currently passes-through only `expert_done`; T9 pipeline reserves its own `distill.*` event namespace to avoid clash).

**Task count:** Part 1 T1-T8 (8) + Part 2 T9-T15 (7) = **15 tasks total**, matching Part 1 forward references (T9 distill, T10+ UI).

**Risks:**
- SP-06 style-distiller + SP-07 wiki-ingestor interfaces assumed; T9 `deps.ingest/distill` signatures may need alignment once implementing — deps injection preserves testability.
- `expert_delta` event requires underlying agent stream tokens; SP-02 `invokeAgent` currently returns final markdown only → T5/T11 treats `expert_delta` as optional (reducer tolerant) so UI still works in non-streaming mode.
- Vault commit frequency on rapid toggles (T12) could bloat git history — consider debouncing in follow-up; not blocking.
