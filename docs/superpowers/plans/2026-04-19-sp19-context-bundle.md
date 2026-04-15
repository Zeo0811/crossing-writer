# SP-19 ContextBundle Implementation Plan

## Goal

Introduce a unified `ContextBundle` abstraction that aggregates project-scoped context (brief, sections, frontmatter, styles, agent configs with per-project overrides, recent tool uses, recent edits, product context) into a single service, replacing ad-hoc prompt assembly across writer/rewrite/topic-expert code paths. Expose the bundle via an HTTP endpoint and a UI chip/modal for transparency. Enforce a token budget with deterministic trimming.

## Architecture

- **Service layer**: `ContextBundleService` in `packages/web-server/src/services/context-bundle-service.ts`
  - `build(projectId)`: compose full bundle from `ProjectStore`, `ArticleStore`, `StylePanelStore`, `styleBindingResolver`, `AgentConfigStore`, `ProjectOverrideStore`.
  - `buildLite(projectId, pick)`: partial build, only reads requested fields to avoid unnecessary I/O.
  - `trimToBudget(bundle, maxTokens=6000)`: drop-order trimming (recentToolUses -> recentEdits -> productContext -> brief summary).
- **Types**: `ContextBundle` shape exported alongside the service; consumed by orchestrator/route/UI.
- **HTTP**: `GET /api/projects/:id/context` returns full bundle JSON.
- **Integrations**: writer-orchestrator, rewrite-selection route, topic-expert consult all call `build()` and prepend rendered `[Project Context]` block to the user message sent to Claude.
- **UI**: `ContextChip.tsx` floating bottom-right on ProjectWorkbench; click opens `ContextModal.tsx` showing pretty-printed JSON (for debugging/trust).

## Tech Stack

- TypeScript, Node (web-server), Vitest for service/route tests, React + Vitest + Testing Library for UI components, Playwright (or existing E2E harness) for end-to-end. Existing stores (`ProjectStore`, `ArticleStore`, `StylePanelStore`, `AgentConfigStore`, `ProjectOverrideStore`) and helpers (`styleBindingResolver`) are reused as-is.

## Tasks (TDD)

### T1 — ContextBundle types + service skeleton
- [ ] Write failing test `packages/web-server/src/services/__tests__/context-bundle-service.test.ts` asserting `ContextBundleService.build(projectId)` returns an object with keys: `projectId`, `brief`, `sections`, `frontmatter`, `styles`, `agents`, `recentEdits`, `recentToolUses`, `productContext`. Use tmp fixture project.
- [ ] Define `ContextBundle` interface + create `context-bundle-service.ts` with skeleton `build()` returning empty shape.
- [ ] Make test pass (shape-only).
- [ ] Commit `sp19(T1): ContextBundle types and service skeleton`.

### T2 — Full build composition
- [ ] Add tests covering each composition source:
  - brief from `ProjectStore.getBrief(projectId)`
  - sections + frontmatter from `ArticleStore.listSections(projectId)`
  - styles from `StylePanelStore` resolved via `styleBindingResolver(projectId)`
  - agents from `AgentConfigStore.listAll()` merged with `ProjectOverrideStore.get(projectId)` (override wins per-field)
- [ ] Implement `build()` wiring each store; merge agents with a pure `mergeAgentOverrides(base, override)` helper + dedicated test.
- [ ] All tests green.
- [ ] Commit `sp19(T2): compose ContextBundle from stores`.

### T3 — Token budget trimming
- [ ] Test `trimToBudget(bundle, 6000)` on oversized fixture (pad `recentToolUses`, `recentEdits`, `productContext`, `brief.summary` to exceed 6000 est tokens). Assert drop order: toolUses emptied first, then edits, then productContext truncated, then brief.summary truncated. Test preserves `sections`/`frontmatter`/`styles`/`agents` always.
- [ ] Implement `estimateTokens(str)` (chars/4 heuristic) + `trimToBudget`.
- [ ] Commit `sp19(T3): token budget trimming`.

### T4 — buildLite partial build
- [ ] Test `buildLite(projectId, ['brief','styles'])` returns only those keys populated; other stores NOT called (spy/mock store methods, assert not invoked).
- [ ] Implement `buildLite` gated on `pick` array.
- [ ] Commit `sp19(T4): buildLite partial reads`.

### T5 — HTTP route
- [ ] Test in `packages/web-server/src/routes/__tests__/context.test.ts`: `GET /api/projects/:id/context` returns 200 + full bundle JSON; 404 when project missing.
- [ ] Register route in `packages/web-server/src/routes/context.ts` + wire into router index.
- [ ] Commit `sp19(T5): GET /api/projects/:id/context route`.

### T6 — writer-orchestrator integration
- [ ] Update tests for writer-orchestrator (existing file under `packages/web-server/src/services/writer-orchestrator` or similar) to assert the outgoing claude invocation user message contains a `[Project Context]` block whose JSON payload matches `ContextBundleService.build(projectId)` (after trim).
- [ ] Replace ad-hoc prompt assembly with `const bundle = trimToBudget(await ctxSvc.build(projectId)); userMsg = renderContextBlock(bundle) + '\n\n' + userMsg;`.
- [ ] Remove now-dead prompt-assembly helpers; keep `renderContextBlock` in `context-bundle-service.ts`.
- [ ] Commit `sp19(T6): writer-orchestrator uses ContextBundle`.

### T7 — rewrite-selection integration
- [ ] Update tests for rewrite-selection route (`packages/web-server/src/routes/rewrite-selection*`) to assert `[Project Context]` block present in the Claude call.
- [ ] Swap to `ContextBundleService.build` + `renderContextBlock`.
- [ ] Commit `sp19(T7): rewrite-selection uses ContextBundle`.

### T8 — topic-expert consult integration
- [ ] Update tests for topic-expert consult route/service to assert same `[Project Context]` block in Claude call. Include asserting agent overrides from the bundle flow through.
- [ ] Swap implementation.
- [ ] Commit `sp19(T8): topic-expert consult uses ContextBundle`.

### T9 — UI ContextChip + ContextModal
- [ ] Component tests in `packages/web-client/src/components/__tests__/ContextChip.test.tsx`: renders floating chip bottom-right; click opens modal.
- [ ] `ContextModal.test.tsx`: fetches `/api/projects/:id/context`, renders JSON pretty-printed inside a `<pre>`.
- [ ] Implement `ContextChip.tsx`, `ContextModal.tsx`; mount chip inside `ProjectWorkbench`.
- [ ] Commit `sp19(T9): ContextChip + ContextModal UI`.

### T10 — E2E
- [ ] E2E spec under `packages/web-server/tests/e2e/context-bundle.e2e.test.ts`:
  - mutate brief via API -> call orchestrator -> assert new brief text appears in captured Claude prompt
  - oversized fixture project -> orchestrator call -> assert rendered context block ≤ budget (estimated tokens ≤ 6000) and toolUses dropped before edits
- [ ] Commit `sp19(T10): ContextBundle end-to-end`.

## Self-Review

- **Shape first (T1) then fill (T2)** keeps early tests tiny and avoids fixture sprawl.
- **Trim ordering is explicit** and tested, so prompt bloat regressions fail loudly.
- **buildLite** exists specifically to keep cheap call sites (e.g. checklist/UI chip previews) from dragging in every store; good perf hedge.
- **Integration invasiveness (T6/T7/T8)**: these rewrite existing call sites. Risk is that current integration tests may assert literal prompt substrings that no longer appear verbatim after wrapping in `[Project Context]`. Mitigation: each task updates its own tests in the same commit; keep `renderContextBlock` stable and documented so snapshot drift is a one-time cost. If writer-orchestrator has complex prompt-assembly logic (system prompt, tool schemas, few-shot), we only replace the *project-context* portion — system prompt + tool wiring stay put.
- **Token heuristic (chars/4)** is coarse but deterministic; acceptable for budget trimming. Can be swapped for tiktoken later without API change.
- **Override merge** is a pure function — easy to fuzz-test if needed.
- **UI chip** is read-only, so no write-path regressions; failure to fetch just hides the modal.
- **E2E** covers the full contract: store mutation -> bundle rebuild -> prompt contains new data, plus the trimming invariant.
