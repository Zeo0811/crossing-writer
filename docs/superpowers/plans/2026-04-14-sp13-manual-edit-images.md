# SP-13 Manual Edit + Image Insertion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-section manual markdown editing + image upload (button + drag-drop) to `ArticleSection`. Backend stores images under `07_projects/<id>/images/` with sha256 dedupe; frontmatter gains `manually_edited` + `edit_history[]`. SP-09 selection rewrite remains functional in render mode.

**Architecture:** Backend adds `POST /api/projects/:id/images` (multipart, mime whitelist, 10MB cap, sha256[:16] dedupe) + `GET /api/projects/:id/images/:filename`. Frontend adds `ArticleSectionEditor` (controlled textarea + toolbar) wrapped by `useImageDrop` hook + `ImageUploadButton`. `ArticleSection` toggles `mode: "render"|"edit"`. `ArticleStore.writeSection` passthroughs new frontmatter fields. Edit button disabled while `writer.<key>.running` is active.

**Tech Stack:** Fastify multipart, Node crypto sha256, React 18, vitest, jsdom, existing `@crossing/writer-client` + `ArticleStore`.

Spec: `/Users/zeoooo/crossing-writer/docs/superpowers/specs/2026-04-14-sp13-manual-edit-images-design.md`

---

## T1 — Backend: POST /api/projects/:id/images upload route

**Files:**
- Create: `/Users/zeoooo/crossing-writer/packages/web-server/src/routes/project-images.ts`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-server/tests/routes-project-images.test.ts`
- Edit: `/Users/zeoooo/crossing-writer/packages/web-server/src/server.ts` (register)

Steps:
- [ ] Read existing route `/Users/zeoooo/crossing-writer/packages/web-server/src/routes/project-sections.ts` first 60 lines to match fastify style, deps injection, error codes.
- [ ] Add `@fastify/multipart` dependency if not present (check `packages/web-server/package.json`); if missing, add and `pnpm install`.
- [ ] Write failing test `routes-project-images.test.ts` that:
  - boots fastify with `registerProjectImageRoutes(app, { projectsRoot: tmpDir })`
  - POSTs multipart with a 4-byte PNG (`\x89PNG\r\n`) → expects `200` + body `{ url, filename, bytes, mime }` with `url` starting `/api/projects/p1/images/` and `filename` matching `/^[0-9a-f]{16}\.png$/`
  - POSTs the same bytes twice → second call returns the SAME filename (dedupe) and does not double-write
  - POSTs `text/plain` payload (mime = `text/plain`) → `415`
  - POSTs 11MB payload → `413`
  - POSTs empty multipart (no file field) → `400`
  - Verifies file exists on disk at `<projectsRoot>/p1/images/<hash>.png`
- [ ] Implement `registerProjectImageRoutes(app, { projectsRoot })`:
  - `app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })` (if not registered elsewhere — guard with try/catch or check `app.hasContentTypeParser`)
  - `app.post<{ Params: { id: string } }>("/api/projects/:id/images", async (req, reply) => { ... })`
  - Use `req.file()`; if undefined → `reply.code(400).send({ error: "no file" })`
  - Whitelist mimetypes: `["image/png","image/jpeg","image/gif","image/webp"]`; else `reply.code(415)`
  - `await file.toBuffer()`; if `file.file.truncated` → `reply.code(413).send({ error: "too large" })`
  - `const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0,16)`
  - ext map: `image/png→.png`, `image/jpeg→.jpg`, `image/gif→.gif`, `image/webp→.webp`
  - target dir: `path.join(projectsRoot, req.params.id, "images")`; `fs.mkdirSync({ recursive: true })`
  - if target file exists → return existing; else `fs.writeFileSync(target, buf)`
  - response `{ url: `/api/projects/${id}/images/${filename}`, filename, bytes: buf.length, mime }`
- [ ] Register in `server.ts` alongside other project routes.
- [ ] `pnpm --filter @crossing/web-server test routes-project-images` passes.
- [ ] Commit: `sp13(T1): add POST /api/projects/:id/images with sha256 dedupe`

## T2 — Backend: GET /api/projects/:id/images/:filename static serve

**Files:**
- Edit: `/Users/zeoooo/crossing-writer/packages/web-server/src/routes/project-images.ts`
- Edit (test): `/Users/zeoooo/crossing-writer/packages/web-server/tests/routes-project-images.test.ts`

Steps:
- [ ] Extend test:
  - POST an image, then GET returned `url` → expect `200`, body bytes equal original, header `content-type` matches mime
  - GET nonexistent `/api/projects/p1/images/deadbeef00000000.png` → `404`
  - GET traversal `/api/projects/p1/images/..%2Fsecrets.txt` → `400` or `404` (not 200 with file contents)
- [ ] Implement `app.get<{ Params: { id: string; filename: string } }>(...)`:
  - validate `filename` matches `/^[0-9a-f]{16}\.(png|jpg|gif|webp)$/` else `reply.code(400)`
  - use `path.basename(filename)` as double guard
  - `const abs = path.join(projectsRoot, id, "images", filename)`; if `!fs.existsSync(abs)` → `reply.code(404)`
  - infer mime from ext; `reply.header("content-type", mime).send(fs.createReadStream(abs))`
- [ ] Tests pass.
- [ ] Commit: `sp13(T2): add GET image static serve with traversal guard`

## T3 — ArticleStore: writeSection frontmatter passthrough

**Files:**
- Edit: `/Users/zeoooo/crossing-writer/packages/article-store/src/article-store.ts` (or wherever `writeSection` lives — locate via Grep)
- Edit (test): corresponding `.test.ts` (same dir)

Steps:
- [ ] Grep `writeSection` across `packages/article-store` and `packages/writer` to locate definition + callers.
- [ ] Add failing test `article-store-manual-edit.test.ts`:
  - create tmp project, write section with `writeSection(key, { body: "x", frontmatter: { manually_edited: true, edit_history: [{ at: "2026-04-14T10:00:00Z", kind: "manual" }] } })`
  - read back raw file → YAML contains `manually_edited: true` and `edit_history` array with 1 entry
  - round-trip: read via `readSection`, overwrite with different body but same frontmatter extras → extras preserved
- [ ] Extend signature to accept optional `manually_edited?: boolean`, `last_edited_at?: string`, `edit_history?: Array<{ at: string; kind: string; summary?: string }>`, `images?: Array<{ url: string; alt?: string }>` inside `frontmatter`; merge into existing fm (do not drop unknown keys).
- [ ] Export TypeScript interface `SectionFrontmatterExtras` from the store package index.
- [ ] Tests pass; run `pnpm --filter @crossing/article-store test`.
- [ ] Commit: `sp13(T3): ArticleStore.writeSection passthrough manually_edited + edit_history`

## T4 — ArticleSectionEditor component (textarea + save/cancel)

**Files:**
- Create: `/Users/zeoooo/crossing-writer/packages/web-app/src/components/ArticleSectionEditor.tsx`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-app/src/components/ArticleSectionEditor.test.tsx`

Steps:
- [ ] Read `ArticleSection.tsx` to match styling + client API (`putSection`).
- [ ] Write failing test (vitest + @testing-library/react + jsdom):
  - renders textarea with `initialBody="hello"` → textarea value === "hello", min-height style 200px or `rows>=10`
  - typing updates value (controlled)
  - click `保存` → calls `onSave(nextBody)` with current textarea value
  - click `取消` → calls `onCancel()` and does NOT call `onSave`
  - `disabled` prop disables textarea + save button
- [ ] Implement component:
  ```tsx
  export interface ArticleSectionEditorProps {
    initialBody: string;
    disabled?: boolean;
    onSave: (body: string) => void | Promise<void>;
    onCancel: () => void;
    projectId: string;
    sectionKey: string;
  }
  ```
  - `const [body, setBody] = useState(initialBody)`; `const ref = useRef<HTMLTextAreaElement>(null)`
  - textarea `style={{ minHeight: 200, width: "100%", fontFamily: "monospace" }}` rows=12
  - toolbar: `[保存]` `[取消]` (left); slots reserved for `[📷 插图]` added in T6
  - save is async; while pending, button text "保存中..." + disabled
- [ ] Tests pass.
- [ ] Commit: `sp13(T4): ArticleSectionEditor controlled textarea + save/cancel`

## T5 — ArticleSection mode toggle + edit integration

**Files:**
- Edit: `/Users/zeoooo/crossing-writer/packages/web-app/src/components/ArticleSection.tsx`
- Edit/Create (test): `/Users/zeoooo/crossing-writer/packages/web-app/src/components/ArticleSection.test.tsx`

Steps:
- [ ] Extend existing ArticleSection test (or create new):
  - default renders ReactMarkdown (render mode); header has button with text `编辑`
  - click edit button → textarea appears (by role), ReactMarkdown gone; button text becomes `预览`
  - click `预览` without editing → back to render mode, no save call
  - edit body, click `保存` → `putSection` spy called with `{ body, frontmatter: { manually_edited: true, last_edited_at, edit_history: [{ at, kind: "manual" }] } }`
  - after save resolves → mode returns to `render`, body shows new content
- [ ] Add `const [mode, setMode] = useState<"render"|"edit">("render")`.
- [ ] Header button: `<button onClick={() => setMode(m => m === "render" ? "edit" : "render")}>{mode === "render" ? "✏️ 编辑" : "👁 预览"}</button>`.
- [ ] In edit mode render `<ArticleSectionEditor>`; `onSave` calls:
  ```ts
  await putSection(projectId, sectionKey, {
    body,
    frontmatter: {
      manually_edited: true,
      last_edited_at: new Date().toISOString(),
      edit_history: [...(existingHistory ?? []).slice(-19), { at: ..., kind: "manual" }],
    },
  });
  setMode("render");
  ```
- [ ] Tests pass; keep existing ArticleSection tests green.
- [ ] Commit: `sp13(T5): ArticleSection render/edit mode toggle`

## T6 — ImageUploadButton subcomponent

**Files:**
- Create: `/Users/zeoooo/crossing-writer/packages/web-app/src/components/ImageUploadButton.tsx`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-app/src/components/ImageUploadButton.test.tsx`
- Edit: `ArticleSectionEditor.tsx` (wire into toolbar)

Steps:
- [ ] Test:
  - renders `📷 插图` button
  - click → hidden `<input type="file" accept="image/*">` click is triggered (spy on `.click()`)
  - fire `change` with a File(name="a.png", type="image/png") → `uploadImage` mock is called with `(projectId, file)`
  - on resolve `{ url: "/api/projects/p1/images/abc.png" }` → `onInsert("![a.png](/api/projects/p1/images/abc.png)")` is called
  - failure path: mock rejects → `onError(err)` called, button re-enabled
- [ ] Implement:
  ```tsx
  export function ImageUploadButton({ projectId, onInsert, onError, disabled }) {
    const ref = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const handle = async (e) => { ...uploadImage(projectId, file)...; onInsert(`![${file.name}](${res.url})`); };
    return <>
      <button disabled={disabled || busy} onClick={() => ref.current?.click()}>📷 插图</button>
      <input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={handle} />
    </>;
  }
  ```
- [ ] In `ArticleSectionEditor`, add helper `insertAtCaret(text)` using `textareaRef.current.selectionStart/End` + `setBody(v.slice(0,s)+text+v.slice(e))`; after insert, restore caret to `s+text.length` via `setTimeout(..,0)` + `setSelectionRange`.
- [ ] Toolbar mounts `<ImageUploadButton onInsert={insertAtCaret} />`.
- [ ] Tests pass.
- [ ] Commit: `sp13(T6): ImageUploadButton with caret insertion`

## T7 — writer-client.ts uploadImage

**Files:**
- Edit: `/Users/zeoooo/crossing-writer/packages/writer-client/src/writer-client.ts` (or locate via Grep for `putSection`)
- Edit (test): same dir `.test.ts`

Steps:
- [ ] Grep `putSection` in `packages/writer-client` to confirm path; read top 40 lines.
- [ ] Test (vitest + msw or fetch mock):
  - `uploadImage("p1", new File([new Uint8Array([1,2,3])], "a.png", { type: "image/png" }))` → POSTs `multipart/form-data` to `/api/projects/p1/images` with field `file`
  - resolves `{ url, filename, bytes, mime }` from JSON
  - on non-2xx → throws Error with message including status
- [ ] Implement:
  ```ts
  export async function uploadImage(projectId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/images`, { method: "POST", body: fd });
    if (!res.ok) throw new Error(`uploadImage ${res.status}`);
    return res.json() as Promise<{ url: string; filename: string; bytes: number; mime: string }>;
  }
  ```
- [ ] Export from package index.
- [ ] Tests pass.
- [ ] Commit: `sp13(T7): writer-client uploadImage`

## T8 — useImageDrop hook

**Files:**
- Create: `/Users/zeoooo/crossing-writer/packages/web-app/src/hooks/useImageDrop.ts`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-app/src/hooks/useImageDrop.test.tsx`

Steps:
- [ ] Test (jsdom):
  - mount a test component: `const ref = useRef(); const { isDragging } = useImageDrop(ref, { projectId, onInsert, onError });` + `<div ref={ref} data-testid="drop"/>`
  - fire `dragover` on div → `isDragging` true; `dragleave` → false
  - fire `drop` with `DataTransfer` carrying a `image/png` File → `uploadImage` mock called; on resolve → `onInsert("![a.png](url)\n")` called
  - drop two files sequentially → two `onInsert` calls, in order
  - drop a non-image `text/plain` file → ignored, no `onInsert`, no upload
- [ ] Implement as `useEffect` that attaches listeners to `ref.current`, with cleanup; `e.preventDefault()` on dragover/drop; guard duplicate uploads via local Promise chain so order is deterministic (`for (const f of files) await uploadOne(f)`).
- [ ] Tests pass.
- [ ] Commit: `sp13(T8): useImageDrop hook with drag-drop upload`

## T9 — Drop overlay UI in editor

**Files:**
- Edit: `ArticleSectionEditor.tsx`
- Edit (test): `ArticleSectionEditor.test.tsx`

Steps:
- [ ] Test:
  - simulate `dragover` on editor container → overlay element with text `拖到这里上传` rendered (by text)
  - `dragleave` → overlay gone
  - while upload in progress (resolved controlled deferred), overlay shows `上传中... 1/1`
- [ ] Wrap textarea with `<div ref={containerRef} style={{position:"relative"}}>`; call `useImageDrop(containerRef, {...})`; when `isDragging || uploading`, render absolute-positioned div with bg `rgba(59,130,246,0.2)` + centered text.
- [ ] Tests pass.
- [ ] Commit: `sp13(T9): drop overlay UI in editor`

## T10 — Concurrency guard against writer SSE running state

**Files:**
- Edit: `ArticleSection.tsx`
- Edit (test): `ArticleSection.test.tsx`

Steps:
- [ ] Grep how ArticleSection consumes writer SSE state (likely `useWriterState` or prop `writerState.running[key]`).
- [ ] Test:
  - mount with `agentRunning={true}` for this section → edit button is disabled, has `title="写作中，请稍后编辑"`
  - `agentRunning={false}` → enabled
  - when mode was `edit` and `agentRunning` flips to true → show notice banner "agent 正在写入此段" (non-blocking; keep editing allowed but warn)
- [ ] Plumb `agentRunning` prop (or derive inside); set `disabled` on edit button + add `title` attr.
- [ ] Tests pass.
- [ ] Commit: `sp13(T10): disable edit while writer running`

## T11 — SP-09 selection rewrite regression test

**Files:**
- Edit (test): `/Users/zeoooo/crossing-writer/packages/web-app/src/components/ArticleSection.test.tsx` (add regression block)

Steps:
- [ ] Add test:
  - render in render mode; simulate text selection inside ReactMarkdown container; fire `mouseup` → `SelectionBubble` still appears (via existing spy / testid `selection-bubble`)
  - toggle to edit mode → SelectionBubble NOT attached to textarea (its listeners should be scoped to render container)
  - toggle back → SelectionBubble works again
- [ ] If listeners currently attach to ArticleSection root, scope them to the render-mode subtree only (move `onMouseUp` from outer `<article>` to the ReactMarkdown wrapper div).
- [ ] All SP-09 tests still green: `pnpm --filter @crossing/web-app test SelectionBubble`.
- [ ] Commit: `sp13(T11): scope SP-09 selection bubble to render mode`

## T12 — Edit history UI expander

**Files:**
- Edit: `ArticleSection.tsx`
- Edit (test): `ArticleSection.test.tsx`

Steps:
- [ ] Test:
  - section with frontmatter `edit_history: [{at:"2026-04-14T10:00:00Z",kind:"manual"},{at:"2026-04-14T11:00:00Z",kind:"manual"},{at:"2026-04-14T12:00:00Z",kind:"manual"}]` → renders `<details>` with summary text `📝 人工编辑 3 次 (最近: 2026-04-14T12:00:00Z)`
  - empty/missing history → expander not rendered
  - expanded → `<li>` per entry with timestamp + kind
- [ ] Implement small `<EditHistoryExpander history={fm.edit_history} />` component inline below section body (both modes).
- [ ] Tests pass.
- [ ] Commit: `sp13(T12): edit history expander`

## T13 — E2E: end-to-end edit + image drop + save

**Files:**
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-app/src/components/ArticleSection.e2e.test.tsx`

Steps:
- [ ] Mount `<ArticleSection projectId="p1" sectionKey="02-bg" initialBody="old" initialFrontmatter={{}} />` with mocked `putSection` + `uploadImage`.
- [ ] Click `✏️ 编辑` → textarea visible.
- [ ] `userEvent.clear(textarea)` + `userEvent.type(textarea, "new body ")`.
- [ ] Simulate drop event with `image/png` file → `uploadImage` mock resolves `{url:"/api/projects/p1/images/abc.png", filename:"abc.png", bytes:3, mime:"image/png"}` → textarea value now contains `new body ![a.png](/api/projects/p1/images/abc.png)\n` (or equivalent at caret end).
- [ ] Click `保存` → `putSection` spy called with body matching above and `frontmatter.manually_edited === true` + `edit_history.length === 1`.
- [ ] Await resolve → mode is render, rendered markdown contains `<img src="/api/projects/p1/images/abc.png">`.
- [ ] Commit: `sp13(T13): e2e edit + image drop + save`

## T14 — Cleanup + regression sweep

**Files:** whole monorepo

Steps:
- [ ] Run full test matrix:
  - `pnpm --filter @crossing/web-server test`
  - `pnpm --filter @crossing/article-store test`
  - `pnpm --filter @crossing/writer-client test`
  - `pnpm --filter @crossing/web-app test`
  - `pnpm --filter @crossing/writer test` (SP-05/SP-10 regression)
- [ ] Fix any broken test that was relying on old ArticleSection internals (likely selectors for header buttons).
- [ ] Grep for TODO/FIXME added during T1–T13; resolve or justify.
- [ ] Run `pnpm -r typecheck` — zero errors.
- [ ] Commit: `sp13(T14): fix regressions + typecheck clean`

---

## Self-Review

- **Spec coverage**: motivation (§1), core concepts (§2: mode toggle T5, image upload T1/T6/T8, manual flag T3/T5), frontend arch (§3.1: editor T4, dropzone via hook T8+overlay T9, client T7), backend arch (§3.2: upload T1, static T2, writeSection T3), UI details (§4: T5 toggle, T9 overlay), frontmatter (§5: T3 passthrough, T5 write, T12 UI), API (§6: T1 POST, T2 GET, putSection reuse T5), concurrency (§7: T10 frontend guard — server lock explicitly out of MVP), acceptance (§8: all 9 checkpoints mapped to T4/T5/T6/T8/T9/T10/T11/T12/T13).
- **TDD discipline**: every task writes failing test BEFORE implementation; commits scoped to one task; no speculative refactors.
- **Out of scope preserved**: no WYSIWYG, no diff viewer, no CRDT, no image cropping, no agent-side `manually_edited` policy (left for future spec).
- **Risks**:
  - `@fastify/multipart` registration collision if already registered elsewhere — T1 guards with `try/catch`.
  - jsdom drop event `DataTransfer` construction is quirky — T8 test may need `Object.defineProperty(event, "dataTransfer", { value: { files } })` fallback.
  - Caret restoration after React re-render needs `setTimeout(...,0)` to wait for reconcile — covered in T6.
  - SelectionBubble listener scope in T11 may require minor refactor in existing code — flagged but isolated.
- **Task count**: 14.
- **Commit strategy**: 14 atomic commits `sp13(T<N>): ...`, each green before next starts.
