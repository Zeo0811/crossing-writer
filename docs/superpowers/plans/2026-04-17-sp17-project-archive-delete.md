# SP-17 Project Archive & Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add location-based archive (soft hide) and hard delete (slug-confirmed) for projects, exposed via Fastify routes and a tabbed ProjectList UI.

**Architecture:** Archive = move project dir to `07_projects/_archive/<id>/`; restore = reverse move; destroy = `fs.rm -r`. No schema change — project status derived from directory location. Backend adds `ProjectStore` methods + 4 routes; frontend adds a tab bar, per-card action menu, and slug-confirm delete modal.

**Tech Stack:** Node.js + TypeScript + Fastify + vitest (web-server); React + @tanstack/react-query + vitest + testing-library (web-ui).

**Spec:** `docs/superpowers/specs/2026-04-17-sp17-project-archive-delete-design.md`

---

## File Structure

**Created:**
- `packages/web-server/tests/project-store-archive.test.ts` — unit tests for archive/restore/destroy/listArchived.
- `packages/web-server/tests/routes-projects-archive.test.ts` — route tests for archive/restore/delete/list variants.
- `packages/web-server/tests/integration-sp17-archive-e2e.test.ts` — full backend E2E flow.
- `packages/web-ui/src/components/project/DeleteProjectModal.tsx` — slug-confirm destructive modal.
- `packages/web-ui/src/components/project/ArchivedProjectList.tsx` — archived tab sub-component.
- `packages/web-ui/src/components/project/__tests__/DeleteProjectModal.test.tsx`
- `packages/web-ui/src/components/project/__tests__/ArchivedProjectList.test.tsx`
- `packages/web-ui/src/pages/__tests__/ProjectList.test.tsx`

**Modified:**
- `packages/web-server/src/services/project-store.ts` — add archive/restore/destroy/listArchived + errors + skip `_archive` in `list()`.
- `packages/web-server/src/routes/projects.ts` — add 3 routes + extend `GET /api/projects` with `include_archived`/`only_archived` query + response body shape.
- `packages/web-ui/src/api/client.ts` — add `archiveProject`/`restoreProject`/`destroyProject`/`listProjectsArchived` methods.
- `packages/web-ui/src/api/types.ts` — extend `Project` with optional `archived: boolean`; add response types.
- `packages/web-ui/src/hooks/useProjects.ts` — add tab hooks + mutation hooks with cache invalidation.
- `packages/web-ui/src/pages/ProjectList.tsx` — tab bar + per-card ⋯ menu, wire modal.

---

## Task 1: ProjectStore archive/restore/destroy/listArchived

**Files:**
- Modify: `packages/web-server/src/services/project-store.ts`
- Test: `packages/web-server/tests/project-store-archive.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web-server/tests/project-store-archive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore, ConfirmationMismatchError, ProjectConflictError } from "../src/services/project-store.js";

function mkStore(): ProjectStore {
  const root = mkdtempSync(join(tmpdir(), "ps-arc-"));
  return new ProjectStore(root);
}

describe("ProjectStore archive/restore/destroy", () => {
  it("archive() moves project dir into _archive/", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Alpha" });
    const activeDir = store.projectDir(p.id);
    expect(existsSync(activeDir)).toBe(true);
    await store.archive(p.id);
    expect(existsSync(activeDir)).toBe(false);
    expect(existsSync(store.archiveDir(p.id))).toBe(true);
    expect(await store.isArchived(p.id)).toBe(true);
  });

  it("archive() throws ProjectConflictError when target already exists", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Beta" });
    // Pre-create collision in _archive
    mkdirSync(store.archiveDir(p.id), { recursive: true });
    writeFileSync(join(store.archiveDir(p.id), "project.json"), "{}");
    await expect(store.archive(p.id)).rejects.toBeInstanceOf(ProjectConflictError);
  });

  it("archive() throws when project not found in active", async () => {
    const store = mkStore();
    await expect(store.archive("nope")).rejects.toThrow(/project_not_found/);
  });

  it("restore() moves archived back to active", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Gamma" });
    await store.archive(p.id);
    await store.restore(p.id);
    expect(existsSync(store.projectDir(p.id))).toBe(true);
    expect(existsSync(store.archiveDir(p.id))).toBe(false);
  });

  it("restore() throws ProjectConflictError on name collision in active", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Delta" });
    await store.archive(p.id);
    // recreate an active dir with same id
    mkdirSync(store.projectDir(p.id), { recursive: true });
    writeFileSync(join(store.projectDir(p.id), "project.json"), "{}");
    await expect(store.restore(p.id)).rejects.toBeInstanceOf(ProjectConflictError);
  });

  it("destroy() with matching slug removes dir (active)", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Echo" });
    await store.destroy(p.id, { confirmSlug: p.slug });
    expect(existsSync(store.projectDir(p.id))).toBe(false);
  });

  it("destroy() with matching slug removes dir (archived)", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Foxtrot" });
    await store.archive(p.id);
    await store.destroy(p.id, { confirmSlug: p.slug });
    expect(existsSync(store.archiveDir(p.id))).toBe(false);
  });

  it("destroy() with wrong slug throws ConfirmationMismatchError and keeps dir", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Golf" });
    await expect(store.destroy(p.id, { confirmSlug: "wrong" })).rejects.toBeInstanceOf(
      ConfirmationMismatchError,
    );
    expect(existsSync(store.projectDir(p.id))).toBe(true);
  });

  it("destroy() throws project_not_found when missing in both locations", async () => {
    const store = mkStore();
    await expect(store.destroy("ghost", { confirmSlug: "ghost" })).rejects.toThrow(
      /project_not_found/,
    );
  });

  it("listArchived() returns only archived projects", async () => {
    const store = mkStore();
    const a = await store.create({ name: "Active" });
    const b = await store.create({ name: "ToArchive" });
    await store.archive(b.id);
    const archived = await store.listArchived();
    expect(archived.map((p) => p.id)).toEqual([b.id]);
    const active = await store.list();
    expect(active.map((p) => p.id)).toEqual([a.id]);
  });

  it("list() skips the _archive directory", async () => {
    const store = mkStore();
    const a = await store.create({ name: "Hotel" });
    await store.archive(a.id);
    const list = await store.list();
    expect(list).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-server && npx vitest run tests/project-store-archive.test.ts`
Expected: FAIL — `archive`/`restore`/`destroy`/`listArchived`/`archiveDir`/`isArchived` not exported; error classes undefined.

- [ ] **Step 3: Implement in project-store.ts**

Modify `packages/web-server/src/services/project-store.ts`:

At top (after imports), add:

```ts
import { rename, rm, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

export class ProjectConflictError extends Error {
  constructor(public readonly id: string, msg: string) {
    super(msg);
    this.name = "ProjectConflictError";
  }
}
export class ConfirmationMismatchError extends Error {
  constructor(public readonly expected: string) {
    super(`confirmation_mismatch: expected ${expected}`);
    this.name = "ConfirmationMismatchError";
  }
}

const ARCHIVE_DIRNAME = "_archive";
```

Replace the `list()` method body to skip `_archive` (and any leading-underscore dir):

```ts
async list(): Promise<Project[]> {
  try {
    const entries = await readdir(this.root, { withFileTypes: true });
    const out: Project[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith("_")) continue; // skip _archive and other metadata dirs
      const p = await this.get(e.name);
      if (p) out.push(p);
    }
    return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
```

Append the following methods inside the `ProjectStore` class (before closing brace):

```ts
archiveDir(id: string): string {
  return join(this.root, ARCHIVE_DIRNAME, id);
}

async isArchived(id: string): Promise<boolean> {
  try {
    await access(join(this.archiveDir(id), "project.json"), fsConstants.F_OK);
    return true;
  } catch { return false; }
}

private async dirExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch { return false; }
}

async archive(id: string): Promise<void> {
  const src = this.projectDir(id);
  if (!(await this.dirExists(join(src, "project.json")))) {
    throw new Error(`project_not_found: ${id}`);
  }
  const dst = this.archiveDir(id);
  if (await this.dirExists(dst)) {
    throw new ProjectConflictError(id, `already_archived: ${id}`);
  }
  await mkdir(join(this.root, ARCHIVE_DIRNAME), { recursive: true });
  await rename(src, dst);
}

async restore(id: string): Promise<void> {
  const src = this.archiveDir(id);
  if (!(await this.dirExists(join(src, "project.json")))) {
    throw new Error(`project_not_found: ${id}`);
  }
  const dst = this.projectDir(id);
  if (await this.dirExists(dst)) {
    throw new ProjectConflictError(id, `name_conflict: ${id} already exists in active`);
  }
  await rename(src, dst);
}

async destroy(id: string, opts: { confirmSlug: string }): Promise<{ removedPath: string }> {
  // locate in active first, then archived
  let target: string | null = null;
  let projJson: string | null = null;
  const activeFile = join(this.projectDir(id), "project.json");
  const archivedFile = join(this.archiveDir(id), "project.json");
  if (await this.dirExists(activeFile)) {
    target = this.projectDir(id);
    projJson = activeFile;
  } else if (await this.dirExists(archivedFile)) {
    target = this.archiveDir(id);
    projJson = archivedFile;
  } else {
    throw new Error(`project_not_found: ${id}`);
  }
  const raw = await readFile(projJson, "utf-8");
  const p = JSON.parse(raw) as Project;
  if (p.slug !== opts.confirmSlug) {
    throw new ConfirmationMismatchError(p.slug);
  }
  await rm(target, { recursive: true, force: true });
  return { removedPath: target };
}

async listArchived(): Promise<Project[]> {
  const archiveRoot = join(this.root, ARCHIVE_DIRNAME);
  try {
    const entries = await readdir(archiveRoot, { withFileTypes: true });
    const out: Project[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const raw = await readFile(join(archiveRoot, e.name, "project.json"), "utf-8");
        out.push(JSON.parse(raw) as Project);
      } catch { /* skip */ }
    }
    return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd packages/web-server && npx vitest run tests/project-store-archive.test.ts tests/project-store.test.ts`
Expected: PASS (all tests, including original project-store.test.ts which still uses `list()`).

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/services/project-store.ts packages/web-server/tests/project-store-archive.test.ts
git -c commit.gpgsign=false commit -m "sp17(T1): ProjectStore archive/restore/destroy/listArchived"
```

---

## Task 2: Verify list() skips `_archive` + explicit regression test

**Files:**
- Test: `packages/web-server/tests/project-store.test.ts`

- [ ] **Step 1: Write additional regression test**

Append to `packages/web-server/tests/project-store.test.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";

describe("ProjectStore.list skip metadata", () => {
  it("ignores directories starting with _", async () => {
    const store = mkStore();
    const p = await store.create({ name: "Keep" });
    // simulate stray metadata dirs
    mkdirSync(join(store.projectDir("_archive"), "some-id"), { recursive: true });
    writeFileSync(join(store.projectDir("_archive"), "some-id", "project.json"), "{}");
    mkdirSync(store.projectDir("_tmp"), { recursive: true });
    const list = await store.list();
    expect(list.map((x) => x.id)).toEqual([p.id]);
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd packages/web-server && npx vitest run tests/project-store.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web-server/tests/project-store.test.ts
git -c commit.gpgsign=false commit -m "sp17(T2): regression test for list() skipping _archive"
```

---

## Task 3: Route `POST /api/projects/:id/archive`

**Files:**
- Modify: `packages/web-server/src/routes/projects.ts`
- Test: `packages/web-server/tests/routes-projects-archive.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web-server/tests/routes-projects-archive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "vault-arc-"));
  const store = new ProjectStore(join(vault, "07_projects"));
  const app = Fastify();
  registerProjectsRoutes(app, { store });
  await app.ready();
  return { app, store };
}

describe("POST /api/projects/:id/archive", () => {
  it("moves project to _archive and returns 200", async () => {
    const { app, store } = await mkApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Alpha" } })
    ).json();
    const res = await app.inject({ method: "POST", url: `/api/projects/${created.id}/archive` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe(created.id);
    expect(existsSync(store.archiveDir(created.id))).toBe(true);
    expect(existsSync(store.projectDir(created.id))).toBe(false);
  });

  it("returns 404 when project missing", async () => {
    const { app } = await mkApp();
    const res = await app.inject({ method: "POST", url: "/api/projects/ghost/archive" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("project_not_found");
  });

  it("returns 409 when already archived", async () => {
    const { app } = await mkApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Beta" } })
    ).json();
    await app.inject({ method: "POST", url: `/api/projects/${created.id}/archive` });
    // create again with same id by recreating active dir via second POST won't reuse id; simulate by direct file
    // easier: attempt to archive the already-archived id — should 404 (not in active)
    const res = await app.inject({ method: "POST", url: `/api/projects/${created.id}/archive` });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web-server && npx vitest run tests/routes-projects-archive.test.ts`
Expected: FAIL — 404 on unknown path.

- [ ] **Step 3: Implement route**

Modify `packages/web-server/src/routes/projects.ts`. Add imports at top:

```ts
import { ProjectConflictError, ConfirmationMismatchError } from "../services/project-store.js";
```

Append inside `registerProjectsRoutes`:

```ts
app.post<{ Params: { id: string } }>("/api/projects/:id/archive", async (req, reply) => {
  try {
    await deps.store.archive(req.params.id);
    return reply.code(200).send({
      ok: true,
      id: req.params.id,
      archived_path: `_archive/${req.params.id}`,
    });
  } catch (e: any) {
    if (e instanceof ProjectConflictError) {
      return reply.code(409).send({ error: "already_archived" });
    }
    if (/project_not_found/.test(e?.message ?? "")) {
      return reply.code(404).send({ error: "project_not_found" });
    }
    throw e;
  }
});
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd packages/web-server && npx vitest run tests/routes-projects-archive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/routes/projects.ts packages/web-server/tests/routes-projects-archive.test.ts
git -c commit.gpgsign=false commit -m "sp17(T3): POST /api/projects/:id/archive route"
```

---

## Task 4: Route `POST /api/projects/:id/restore`

**Files:**
- Modify: `packages/web-server/src/routes/projects.ts`
- Test: `packages/web-server/tests/routes-projects-archive.test.ts`

- [ ] **Step 1: Append failing test**

Append to `packages/web-server/tests/routes-projects-archive.test.ts`:

```ts
describe("POST /api/projects/:id/restore", () => {
  it("moves project back from archive", async () => {
    const { app, store } = await mkApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Charlie" } })
    ).json();
    await app.inject({ method: "POST", url: `/api/projects/${created.id}/archive` });
    const res = await app.inject({ method: "POST", url: `/api/projects/${created.id}/restore` });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(existsSync(store.projectDir(created.id))).toBe(true);
    expect(existsSync(store.archiveDir(created.id))).toBe(false);
  });

  it("returns 404 when archived project missing", async () => {
    const { app } = await mkApp();
    const res = await app.inject({ method: "POST", url: "/api/projects/nope/restore" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("project_not_found");
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd packages/web-server && npx vitest run tests/routes-projects-archive.test.ts -t "restore"`
Expected: FAIL — route missing.

- [ ] **Step 3: Implement route**

Append inside `registerProjectsRoutes` in `packages/web-server/src/routes/projects.ts`:

```ts
app.post<{ Params: { id: string } }>("/api/projects/:id/restore", async (req, reply) => {
  try {
    await deps.store.restore(req.params.id);
    return reply.code(200).send({ ok: true, id: req.params.id });
  } catch (e: any) {
    if (e instanceof ProjectConflictError) {
      return reply.code(409).send({ error: "name_conflict", detail: e.message });
    }
    if (/project_not_found/.test(e?.message ?? "")) {
      return reply.code(404).send({ error: "project_not_found" });
    }
    throw e;
  }
});
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd packages/web-server && npx vitest run tests/routes-projects-archive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/routes/projects.ts packages/web-server/tests/routes-projects-archive.test.ts
git -c commit.gpgsign=false commit -m "sp17(T4): POST /api/projects/:id/restore route"
```

---

## Task 5: Route `DELETE /api/projects/:id` with slug confirmation + list query extensions

**Files:**
- Modify: `packages/web-server/src/routes/projects.ts`
- Test: `packages/web-server/tests/routes-projects-archive.test.ts`

- [ ] **Step 1: Append failing tests (destroy + list variants)**

Append to `packages/web-server/tests/routes-projects-archive.test.ts`:

```ts
describe("DELETE /api/projects/:id", () => {
  it("hard-deletes active project when slug matches", async () => {
    const { app, store } = await mkApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Delete Me" } })
    ).json();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.id}`,
      payload: { confirm: created.slug },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(existsSync(store.projectDir(created.id))).toBe(false);
  });

  it("rejects with 400 on slug mismatch and keeps dir", async () => {
    const { app, store } = await mkApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Keep Me" } })
    ).json();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.id}`,
      payload: { confirm: "wrong-slug" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("confirmation_mismatch");
    expect(res.json().expected).toBe(created.slug);
    expect(existsSync(store.projectDir(created.id))).toBe(true);
  });

  it("returns 404 when project missing", async () => {
    const { app } = await mkApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/ghost`,
      payload: { confirm: "ghost" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("deletes archived project when found only in _archive", async () => {
    const { app, store } = await mkApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Arch Del" } })
    ).json();
    await app.inject({ method: "POST", url: `/api/projects/${created.id}/archive` });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.id}`,
      payload: { confirm: created.slug },
    });
    expect(res.statusCode).toBe(200);
    expect(existsSync(store.archiveDir(created.id))).toBe(false);
  });
});

describe("GET /api/projects with archive query variants", () => {
  it("default returns { items, archived_count }", async () => {
    const { app } = await mkApp();
    const a = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "A" } })).json();
    const b = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "B" } })).json();
    await app.inject({ method: "POST", url: `/api/projects/${b.id}/archive` });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((p: any) => p.id)).toEqual([a.id]);
    expect(body.archived_count).toBe(1);
  });

  it("?only_archived=1 returns archived items with active_count", async () => {
    const { app } = await mkApp();
    const a = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "A" } })).json();
    const b = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "B" } })).json();
    await app.inject({ method: "POST", url: `/api/projects/${b.id}/archive` });
    const res = await app.inject({ method: "GET", url: "/api/projects?only_archived=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((p: any) => p.id)).toEqual([b.id]);
    expect(body.active_count).toBe(1);
  });

  it("?include_archived=1 returns union with archived flag", async () => {
    const { app } = await mkApp();
    const a = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "A" } })).json();
    const b = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "B" } })).json();
    await app.inject({ method: "POST", url: `/api/projects/${b.id}/archive` });
    const res = await app.inject({ method: "GET", url: "/api/projects?include_archived=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const byId = Object.fromEntries(body.items.map((p: any) => [p.id, p.archived]));
    expect(byId[a.id]).toBe(false);
    expect(byId[b.id]).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `cd packages/web-server && npx vitest run tests/routes-projects-archive.test.ts`
Expected: FAIL — DELETE route missing; GET body shape mismatch.

- [ ] **Step 3: Implement DELETE route + rewrite list handler**

In `packages/web-server/src/routes/projects.ts`, **replace** the existing `app.get("/api/projects", ...)` block with:

```ts
app.get<{ Querystring: { include_archived?: string; only_archived?: string } }>(
  "/api/projects",
  async (req) => {
    const q = req.query ?? {};
    if (q.only_archived === "1") {
      const items = await deps.store.listArchived();
      const active_count = (await deps.store.list()).length;
      return { items, active_count };
    }
    if (q.include_archived === "1") {
      const [active, archived] = await Promise.all([
        deps.store.list(),
        deps.store.listArchived(),
      ]);
      const items = [
        ...active.map((p) => ({ ...p, archived: false })),
        ...archived.map((p) => ({ ...p, archived: true })),
      ];
      return { items };
    }
    const [items, archived] = await Promise.all([
      deps.store.list(),
      deps.store.listArchived(),
    ]);
    return { items, archived_count: archived.length };
  },
);
```

Then append the DELETE route:

```ts
app.delete<{ Params: { id: string }; Body: { confirm?: string } }>(
  "/api/projects/:id",
  async (req, reply) => {
    const confirm = req.body?.confirm;
    if (typeof confirm !== "string" || confirm.length === 0) {
      return reply.code(400).send({ error: "confirmation_required" });
    }
    try {
      const { removedPath } = await deps.store.destroy(req.params.id, { confirmSlug: confirm });
      return reply.code(200).send({ ok: true, id: req.params.id, removed_path: removedPath });
    } catch (e: any) {
      if (e instanceof ConfirmationMismatchError) {
        return reply.code(400).send({ error: "confirmation_mismatch", expected: e.expected });
      }
      if (/project_not_found/.test(e?.message ?? "")) {
        return reply.code(404).send({ error: "project_not_found" });
      }
      throw e;
    }
  },
);
```

- [ ] **Step 4: Update existing routes-projects.test.ts expectations**

The existing `tests/routes-projects.test.ts` asserts `GET /api/projects` returns an array. Update that single test:

Open `packages/web-server/tests/routes-projects.test.ts`. Replace:

```ts
  it("GET /api/projects lists projects", async () => {
    const { app } = await mkApp();
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "A" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "B" } });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });
```

With:

```ts
  it("GET /api/projects lists projects with archived_count", async () => {
    const { app } = await mkApp();
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "A" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "B" } });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    expect(body.archived_count).toBe(0);
  });
```

- [ ] **Step 5: Run all backend route tests**

Run: `cd packages/web-server && npx vitest run tests/routes-projects-archive.test.ts tests/routes-projects.test.ts`
Expected: PASS.

- [ ] **Step 6: Grep for other backend callers of `GET /api/projects`**

Run: `cd packages/web-server && npx vitest run`
Expected: PASS. If other tests fail because they expected an array, update them to `.items`. If anything breaks, fix minimally and re-run.

- [ ] **Step 7: Commit**

```bash
git add packages/web-server/src/routes/projects.ts packages/web-server/tests/routes-projects-archive.test.ts packages/web-server/tests/routes-projects.test.ts
git -c commit.gpgsign=false commit -m "sp17(T5): DELETE /api/projects/:id + list query variants"
```

---

## Task 6: Frontend API client + hooks + types

**Files:**
- Modify: `packages/web-ui/src/api/types.ts`, `packages/web-ui/src/api/client.ts`, `packages/web-ui/src/hooks/useProjects.ts`

- [ ] **Step 1: Extend types**

Open `packages/web-ui/src/api/types.ts`. Find the `Project` type and below it (or at bottom of file) add:

```ts
export interface ProjectListResponse {
  items: Project[];
  archived_count?: number;
  active_count?: number;
}

export interface ArchivedProject extends Project {
  archived?: boolean;
}
```

If the existing `Project` interface does not include an optional `archived?: boolean`, add it:

```ts
// inside Project interface
archived?: boolean;
```

- [ ] **Step 2: Update client.ts**

In `packages/web-ui/src/api/client.ts`, replace:

```ts
  listProjects: () => request<Project[]>("/api/projects"),
```

with:

```ts
  listProjects: () => request<{ items: Project[]; archived_count: number }>("/api/projects"),
  listArchivedProjects: () =>
    request<{ items: Project[]; active_count: number }>("/api/projects?only_archived=1"),
  archiveProject: (id: string) =>
    request<{ ok: true; id: string }>(`/api/projects/${id}/archive`, { method: "POST" }),
  restoreProject: (id: string) =>
    request<{ ok: true; id: string }>(`/api/projects/${id}/restore`, { method: "POST" }),
  destroyProject: (id: string, confirm: string) =>
    request<{ ok: true; id: string }>(`/api/projects/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm }),
    }),
```

- [ ] **Step 3: Update useProjects.ts**

Replace `packages/web-ui/src/hooks/useProjects.ts` with:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
}

export function useArchivedProjects(enabled = true) {
  return useQuery({
    queryKey: ["projects", "archived"],
    queryFn: api.listArchivedProjects,
    enabled,
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ["projects", id],
    queryFn: () => api.getProject(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["projects"] });
  qc.invalidateQueries({ queryKey: ["projects", "archived"] });
}

export function useArchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.archiveProject(id),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRestoreProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.restoreProject(id),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDestroyProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; confirm: string }) =>
      api.destroyProject(args.id, args.confirm),
    onSuccess: () => invalidateAll(qc),
  });
}
```

- [ ] **Step 4: Fix ProjectList consumers of old array shape**

Existing `ProjectList.tsx` uses `data?.length` and `data.map(...)`. With new shape, replace in `packages/web-ui/src/pages/ProjectList.tsx` (temporary adapter — full tab UI in T7):

```ts
const { data, isLoading } = useProjects();
```

Below it, extract items:

```ts
const activeItems = data?.items ?? [];
const archivedCount = data?.archived_count ?? 0;
```

Then replace `data?.length ? (` with `activeItems.length ? (` and `data.map((p) => (` with `activeItems.map((p) => (`.

- [ ] **Step 5: Type-check & run existing web-ui tests**

Run: `cd packages/web-ui && npx vitest run && npx tsc --noEmit`
Expected: PASS + no TS errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web-ui/src/api/types.ts packages/web-ui/src/api/client.ts packages/web-ui/src/hooks/useProjects.ts packages/web-ui/src/pages/ProjectList.tsx
git -c commit.gpgsign=false commit -m "sp17(T6): web-ui client + hooks for archive/restore/destroy"
```

---

## Task 7: ProjectList tabs + ⋯ menu + ArchivedProjectList

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectList.tsx`
- Create: `packages/web-ui/src/components/project/ArchivedProjectList.tsx`
- Create: `packages/web-ui/src/components/project/__tests__/ArchivedProjectList.test.tsx`
- Create: `packages/web-ui/src/pages/__tests__/ProjectList.test.tsx`

- [ ] **Step 1: Write failing tests for ArchivedProjectList**

Create `packages/web-ui/src/components/project/__tests__/ArchivedProjectList.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ArchivedProjectList } from "../ArchivedProjectList";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ArchivedProjectList", () => {
  const sample = [
    { id: "a1", name: "First", slug: "first", status: "created", stage: "intake", updated_at: new Date().toISOString() } as any,
  ];

  it("renders archived cards with 恢复 and 硬删 buttons", () => {
    wrap(<ArchivedProjectList items={sample} onRestore={() => {}} onDelete={() => {}} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("恢复")).toBeInTheDocument();
    expect(screen.getByText("硬删")).toBeInTheDocument();
  });

  it("calls onRestore(id) when 恢复 clicked", () => {
    const onRestore = vi.fn();
    wrap(<ArchivedProjectList items={sample} onRestore={onRestore} onDelete={() => {}} />);
    fireEvent.click(screen.getByText("恢复"));
    expect(onRestore).toHaveBeenCalledWith("a1");
  });

  it("calls onDelete(project) when 硬删 clicked", () => {
    const onDelete = vi.fn();
    wrap(<ArchivedProjectList items={sample} onRestore={() => {}} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("硬删"));
    expect(onDelete).toHaveBeenCalledWith(sample[0]);
  });

  it("renders empty state when no items", () => {
    wrap(<ArchivedProjectList items={[]} onRestore={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/暂无已归档项目/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `cd packages/web-ui && npx vitest run src/components/project/__tests__/ArchivedProjectList.test.tsx`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement ArchivedProjectList**

Create `packages/web-ui/src/components/project/ArchivedProjectList.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { Project } from "../../api/types";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";

export interface ArchivedProjectListProps {
  items: Project[];
  onRestore: (id: string) => void;
  onDelete: (project: Project) => void;
}

export function ArchivedProjectList({ items, onRestore, onDelete }: ArchivedProjectListProps) {
  if (items.length === 0) {
    return (
      <div className="text-meta text-[13px] py-10 text-center" data-testid="archived-empty">
        暂无已归档项目
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="archived-grid">
      {items.map((p) => (
        <Card
          key={p.id}
          variant="agent"
          data-testid="archived-card"
          className="opacity-70"
        >
          <div className="flex justify-between items-start gap-2">
            <Link
              to={`/projects/${p.id}`}
              className="font-semibold text-[14px] text-heading no-underline hover:text-accent"
            >
              {p.name}
            </Link>
            <Chip variant="legacy">已归档</Chip>
          </div>
          <div className="font-mono-term text-[11px] text-meta tracking-[0.04em]">
            {p.stage} · UPDATED {new Date(p.updated_at).toLocaleString()}
          </div>
          <div className="flex gap-2 mt-3">
            <Button variant="secondary" onClick={() => onRestore(p.id)}>
              恢复
            </Button>
            <Button variant="secondary" onClick={() => onDelete(p)}>
              硬删
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run ArchivedProjectList test**

Run: `cd packages/web-ui && npx vitest run src/components/project/__tests__/ArchivedProjectList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write failing test for ProjectList tabs**

Create `packages/web-ui/src/pages/__tests__/ProjectList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ProjectList } from "../ProjectList";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectList tabs", () => {
  beforeEach(() => {
    (globalThis.fetch as any) = vi.fn((url: string) => {
      if (url === "/api/projects") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [{ id: "act1", name: "Active One", slug: "active-one", status: "created", stage: "intake", updated_at: new Date().toISOString() }],
              archived_count: 2,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url === "/api/projects?only_archived=1") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                { id: "arc1", name: "Arch One", slug: "arch-one", status: "created", stage: "intake", updated_at: new Date().toISOString() },
                { id: "arc2", name: "Arch Two", slug: "arch-two", status: "created", stage: "intake", updated_at: new Date().toISOString() },
              ],
              active_count: 1,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url === "/api/cli-health") {
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    });
  });

  it("shows active items by default with badge counts", async () => {
    wrap(<ProjectList />);
    await waitFor(() => expect(screen.getByText("Active One")).toBeInTheDocument());
    expect(screen.getByTestId("tab-active")).toHaveTextContent("进行中");
    expect(screen.getByTestId("tab-active")).toHaveTextContent("1");
    expect(screen.getByTestId("tab-archived")).toHaveTextContent("已归档");
    expect(screen.getByTestId("tab-archived")).toHaveTextContent("2");
  });

  it("switching to archived tab shows archived projects", async () => {
    wrap(<ProjectList />);
    await waitFor(() => expect(screen.getByText("Active One")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tab-archived"));
    await waitFor(() => expect(screen.getByText("Arch One")).toBeInTheDocument());
    expect(screen.getByText("Arch Two")).toBeInTheDocument();
  });

  it("active card ⋯ menu shows 归档 and 硬删", async () => {
    wrap(<ProjectList />);
    await waitFor(() => expect(screen.getByText("Active One")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("card-menu-btn-act1"));
    expect(screen.getByText("归档")).toBeInTheDocument();
    expect(screen.getByText("硬删")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run failing test**

Run: `cd packages/web-ui && npx vitest run src/pages/__tests__/ProjectList.test.tsx`
Expected: FAIL — tab elements and menu buttons missing.

- [ ] **Step 7: Implement tabs + menu in ProjectList.tsx**

Rewrite `packages/web-ui/src/pages/ProjectList.tsx` (keep existing imports; add the new ones):

```tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  useProjects,
  useCreateProject,
  useArchivedProjects,
  useArchiveProject,
  useRestoreProject,
  useDestroyProject,
} from "../hooks/useProjects";
import { useCliHealth } from "../hooks/useCliHealth";
import { CliHealthDot } from "../components/status/CliHealthDot";
import { TopNav } from "../components/layout/TopNav";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { SpriteIcon } from "../components/icons";
import { ArchivedProjectList } from "../components/project/ArchivedProjectList";
import { DeleteProjectModal } from "../components/project/DeleteProjectModal";
import type { Project } from "../api/types";

type ChipVariant = "active" | "waiting" | "legacy" | "deleted" | "warn";
function statusVariant(status?: string): ChipVariant {
  if (!status) return "waiting";
  const s = status.toLowerCase();
  if (s === "active" || s === "running") return "active";
  if (s === "legacy" || s === "archived") return "legacy";
  if (s === "deleted") return "deleted";
  if (s === "blocked" || s === "warn") return "warn";
  return "waiting";
}

type Tab = "active" | "archived";

export function ProjectList() {
  const [tab, setTab] = useState<Tab>("active");
  const { data: activeData, isLoading: activeLoading } = useProjects();
  const { data: archivedData, isLoading: archivedLoading } = useArchivedProjects(tab === "archived");
  const { data: cliHealth, loading: cliLoading } = useCliHealth();
  const create = useCreateProject();
  const archive = useArchiveProject();
  const restore = useRestoreProject();
  const destroy = useDestroyProject();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const activeItems = activeData?.items ?? [];
  const archivedCount = activeData?.archived_count ?? 0;
  const activeCount = archivedData?.active_count ?? activeItems.length;
  const archivedItems = archivedData?.items ?? [];

  async function handleCreate() {
    if (!name.trim()) return;
    const p = await create.mutateAsync(name.trim());
    navigate(`/projects/${p.id}`);
  }

  async function handleArchive(id: string) {
    setMenuOpenId(null);
    await archive.mutateAsync(id);
  }
  async function handleRestore(id: string) {
    await restore.mutateAsync(id);
  }
  async function handleConfirmDelete(confirm: string) {
    if (!deleteTarget) return;
    await destroy.mutateAsync({ id: deleteTarget.id, confirm });
    setDeleteTarget(null);
  }

  return (
    <div data-testid="page-project-list" className="min-h-screen bg-bg-0 text-body">
      <div className="max-w-[1180px] mx-auto px-7 pt-7 pb-[72px] flex flex-col gap-6">
        <TopNav />

        <div className="flex items-center gap-3 justify-end">
          {cliHealth ? (
            <>
              <CliHealthDot label="CLAUDE" item={cliHealth.claude} />
              <CliHealthDot label="CODEX" item={cliHealth.codex} />
            </>
          ) : cliLoading ? (
            <>
              <span data-testid="cli-dot-placeholder" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 0, backgroundColor: "var(--hair-strong)" }} />
              <span data-testid="cli-dot-placeholder" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 0, backgroundColor: "var(--hair-strong)" }} />
            </>
          ) : null}
          <Link to="/style-panels" className="no-underline text-[12px] text-meta hover:text-accent border border-hair rounded-[2px] px-2 py-[3px]">风格面板</Link>
          <Link to="/knowledge" className="no-underline text-[12px] text-meta hover:text-accent border border-hair rounded-[2px] px-2 py-[3px]">知识库</Link>
          <Link to="/config" className="no-underline text-[12px] text-meta hover:text-accent border border-hair rounded-[2px] px-2 py-[3px]">⚙️ 配置工作台</Link>
          <Button variant="primary" onClick={() => setShowNew(true)}>新建项目</Button>
        </div>

        {showNew && (
          <Card variant="panel">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="项目名" className="w-full mb-3" />
            <div className="flex gap-2">
              <Button variant="primary" onClick={handleCreate}>创建</Button>
              <Button variant="secondary" onClick={() => setShowNew(false)}>取消</Button>
            </div>
          </Card>
        )}

        <Card halftone>
          <div className="flex justify-between items-end mb-[18px] gap-4">
            <div>
              <h2 className="font-sans font-semibold text-[15px] text-heading m-0">Projects</h2>
              <p className="text-[12px] text-meta m-0 mt-1">所有项目卡片，按最近更新倒序。</p>
            </div>
          </div>

          <div className="flex gap-2 mb-4 border-b border-hair">
            <button
              data-testid="tab-active"
              onClick={() => setTab("active")}
              className={`px-3 py-2 text-[13px] ${tab === "active" ? "border-b-2 border-accent text-heading" : "text-meta"}`}
            >
              进行中 ({activeCount})
            </button>
            <button
              data-testid="tab-archived"
              onClick={() => setTab("archived")}
              className={`px-3 py-2 text-[13px] ${tab === "archived" ? "border-b-2 border-accent text-heading" : "text-meta"}`}
            >
              已归档 ({archivedCount})
            </button>
          </div>

          {tab === "active" ? (
            activeLoading ? (
              <p className="text-meta text-[13px]">加载中…</p>
            ) : activeItems.length ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {activeItems.map((p) => (
                  <Card key={p.id} variant="agent" data-testid="project-card" className="hover:border-l-accent-soft relative">
                    <div className="flex justify-between items-start gap-2">
                      <Link to={`/projects/${p.id}`} className="font-semibold text-[14px] text-heading no-underline hover:text-accent">{p.name}</Link>
                      <div className="flex items-center gap-2">
                        <Chip variant={statusVariant(p.status)}>{p.status}</Chip>
                        <button
                          data-testid={`card-menu-btn-${p.id}`}
                          aria-label="actions"
                          onClick={() => setMenuOpenId(menuOpenId === p.id ? null : p.id)}
                          className="text-meta hover:text-heading px-1"
                        >
                          ⋯
                        </button>
                      </div>
                    </div>
                    <div className="font-mono-term text-[11px] text-meta tracking-[0.04em]">{p.stage} · UPDATED {new Date(p.updated_at).toLocaleString()}</div>
                    {menuOpenId === p.id && (
                      <div
                        data-testid={`card-menu-${p.id}`}
                        className="absolute right-2 top-10 bg-bg-1 border border-hair rounded-[2px] shadow-md z-10 flex flex-col"
                      >
                        <button className="px-3 py-2 text-left text-[13px] hover:bg-bg-2" onClick={() => handleArchive(p.id)}>归档</button>
                        <button className="px-3 py-2 text-left text-[13px] text-red-600 hover:bg-bg-2" onClick={() => { setMenuOpenId(null); setDeleteTarget(p); }}>硬删</button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-10 text-meta">
                <SpriteIcon size={32} />
                <p className="font-sans text-[13px] m-0">还没有项目 — no projects yet.</p>
              </div>
            )
          ) : archivedLoading ? (
            <p className="text-meta text-[13px]">加载中…</p>
          ) : (
            <ArchivedProjectList
              items={archivedItems}
              onRestore={handleRestore}
              onDelete={(p) => setDeleteTarget(p)}
            />
          )}
        </Card>

        {deleteTarget && (
          <DeleteProjectModal
            project={deleteTarget}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={handleConfirmDelete}
          />
        )}
      </div>
    </div>
  );
}
```

> Note: `DeleteProjectModal` is imported but implemented in Task 8. Create a temporary placeholder now so this task's tests can run — we'll flesh it out in Task 8.

Create a placeholder `packages/web-ui/src/components/project/DeleteProjectModal.tsx`:

```tsx
import type { Project } from "../../api/types";
export interface DeleteProjectModalProps {
  project: Project;
  onCancel: () => void;
  onConfirm: (slug: string) => void;
}
export function DeleteProjectModal(_props: DeleteProjectModalProps) {
  return null;
}
```

- [ ] **Step 8: Run ProjectList test**

Run: `cd packages/web-ui && npx vitest run src/pages/__tests__/ProjectList.test.tsx src/components/project/__tests__/ArchivedProjectList.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/web-ui/src/pages/ProjectList.tsx packages/web-ui/src/components/project/ArchivedProjectList.tsx packages/web-ui/src/components/project/DeleteProjectModal.tsx packages/web-ui/src/components/project/__tests__/ArchivedProjectList.test.tsx packages/web-ui/src/pages/__tests__/ProjectList.test.tsx
git -c commit.gpgsign=false commit -m "sp17(T7): ProjectList tabs + per-card menu + ArchivedProjectList"
```

---

## Task 8: DeleteProjectModal with slug confirmation

**Files:**
- Modify: `packages/web-ui/src/components/project/DeleteProjectModal.tsx`
- Create: `packages/web-ui/src/components/project/__tests__/DeleteProjectModal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `packages/web-ui/src/components/project/__tests__/DeleteProjectModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeleteProjectModal } from "../DeleteProjectModal";

const sample = {
  id: "p1", name: "Sample", slug: "sample", status: "created", stage: "intake",
  updated_at: new Date().toISOString(),
} as any;

describe("DeleteProjectModal", () => {
  it("renders project name and slug hint", () => {
    render(<DeleteProjectModal project={sample} onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText(/删除项目/)).toBeInTheDocument();
    expect(screen.getByText("Sample", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/sample/)).toBeInTheDocument();
  });

  it("confirm button is disabled until slug is typed correctly", () => {
    const onConfirm = vi.fn();
    render(<DeleteProjectModal project={sample} onCancel={() => {}} onConfirm={onConfirm} />);
    const btn = screen.getByTestId("confirm-delete-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const input = screen.getByTestId("confirm-slug-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "wrong" } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "sample" } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledWith("sample");
  });

  it("cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    render(<DeleteProjectModal project={sample} onCancel={onCancel} onConfirm={() => {}} />);
    fireEvent.click(screen.getByTestId("cancel-delete-btn"));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `cd packages/web-ui && npx vitest run src/components/project/__tests__/DeleteProjectModal.test.tsx`
Expected: FAIL — placeholder renders null.

- [ ] **Step 3: Implement real modal**

Replace `packages/web-ui/src/components/project/DeleteProjectModal.tsx`:

```tsx
import { useState } from "react";
import type { Project } from "../../api/types";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

export interface DeleteProjectModalProps {
  project: Project;
  onCancel: () => void;
  onConfirm: (slug: string) => void;
}

export function DeleteProjectModal({ project, onCancel, onConfirm }: DeleteProjectModalProps) {
  const [value, setValue] = useState("");
  const matches = value === project.slug;

  return (
    <div
      data-testid="delete-project-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-bg-1 border border-hair rounded-[2px] p-6 w-[420px] flex flex-col gap-4">
        <h3 className="text-heading text-[15px] font-semibold m-0">
          删除项目「{project.name}」？
        </h3>
        <p className="text-[13px] text-meta m-0">
          此操作不可恢复。项目目录及其所有资产（简报 / 案例 / 图片 / 稿件）将被永久删除。
        </p>
        <p className="text-[13px] text-body m-0">
          请输入项目 slug <code className="bg-bg-2 px-1">{project.slug}</code> 确认删除：
        </p>
        <Input
          data-testid="confirm-slug-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={project.slug}
        />
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onCancel} data-testid="cancel-delete-btn">
            取消
          </Button>
          <button
            data-testid="confirm-delete-btn"
            disabled={!matches}
            onClick={() => onConfirm(value)}
            className={`px-4 py-2 text-[13px] rounded-[2px] ${matches ? "bg-red-600 text-white hover:bg-red-700" : "bg-bg-2 text-meta cursor-not-allowed"}`}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: If `Input` component doesn't pass through `data-testid`**

Check by running: `cd packages/web-ui && npx vitest run src/components/project/__tests__/DeleteProjectModal.test.tsx`
If the test fails because `screen.getByTestId("confirm-slug-input")` can't find the element, switch the `<Input ... />` line to a plain `<input>` with the same props. Otherwise leave as is.

- [ ] **Step 5: Run test**

Run: `cd packages/web-ui && npx vitest run src/components/project/__tests__/DeleteProjectModal.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web-ui/src/components/project/DeleteProjectModal.tsx packages/web-ui/src/components/project/__tests__/DeleteProjectModal.test.tsx
git -c commit.gpgsign=false commit -m "sp17(T8): DeleteProjectModal with slug confirmation"
```

---

## Task 9: Backend E2E integration test

**Files:**
- Create: `packages/web-server/tests/integration-sp17-archive-e2e.test.ts`

- [ ] **Step 1: Write full-flow E2E test**

Create `packages/web-server/tests/integration-sp17-archive-e2e.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "vault-sp17-"));
  const store = new ProjectStore(join(vault, "07_projects"));
  const app = Fastify();
  registerProjectsRoutes(app, { store });
  await app.ready();
  return { app, store };
}

describe("SP-17 E2E: list → archive → restore → destroy", () => {
  it("full flow via HTTP", async () => {
    const { app, store } = await mkApp();

    // 1. create two projects
    const one = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "E2E One" } })
    ).json();
    const two = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "E2E Two" } })
    ).json();

    // 2. list — both active, archived_count = 0
    let listRes = await app.inject({ method: "GET", url: "/api/projects" });
    expect(listRes.json().items).toHaveLength(2);
    expect(listRes.json().archived_count).toBe(0);

    // 3. archive "two"
    const arcRes = await app.inject({ method: "POST", url: `/api/projects/${two.id}/archive` });
    expect(arcRes.statusCode).toBe(200);

    // 4. active list — only one; archived_count = 1
    listRes = await app.inject({ method: "GET", url: "/api/projects" });
    expect(listRes.json().items.map((p: any) => p.id)).toEqual([one.id]);
    expect(listRes.json().archived_count).toBe(1);

    // 5. only_archived — only two
    const archivedList = await app.inject({ method: "GET", url: "/api/projects?only_archived=1" });
    expect(archivedList.json().items.map((p: any) => p.id)).toEqual([two.id]);

    // 6. restore two
    const restRes = await app.inject({ method: "POST", url: `/api/projects/${two.id}/restore` });
    expect(restRes.statusCode).toBe(200);
    expect(existsSync(store.projectDir(two.id))).toBe(true);

    // 7. delete two with wrong slug → 400
    const badDel = await app.inject({
      method: "DELETE",
      url: `/api/projects/${two.id}`,
      payload: { confirm: "not-the-slug" },
    });
    expect(badDel.statusCode).toBe(400);
    expect(existsSync(store.projectDir(two.id))).toBe(true);

    // 8. delete two with correct slug → 200
    const okDel = await app.inject({
      method: "DELETE",
      url: `/api/projects/${two.id}`,
      payload: { confirm: two.slug },
    });
    expect(okDel.statusCode).toBe(200);
    expect(existsSync(store.projectDir(two.id))).toBe(false);
    expect(existsSync(store.archiveDir(two.id))).toBe(false);

    // 9. final list — only "one"
    listRes = await app.inject({ method: "GET", url: "/api/projects" });
    expect(listRes.json().items.map((p: any) => p.id)).toEqual([one.id]);
    expect(listRes.json().archived_count).toBe(0);
  });
});
```

- [ ] **Step 2: Run E2E + full web-server suite**

Run: `cd packages/web-server && npx vitest run`
Expected: PASS (all tests).

- [ ] **Step 3: Run full web-ui suite**

Run: `cd packages/web-ui && npx vitest run && npx tsc --noEmit`
Expected: PASS + no TS errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web-server/tests/integration-sp17-archive-e2e.test.ts
git -c commit.gpgsign=false commit -m "sp17(T9): backend E2E for archive/restore/destroy flow"
```

---

## Self-Review Notes

- **Spec §3.1 ProjectStore**: covered in T1 (archive/restore/destroy/listArchived/isArchived/archiveDir + error classes) and T2 (list() skip).
- **Spec §3.2 Routes**: T3 archive, T4 restore, T5 DELETE + GET query variants.
- **Spec §3.3 Cascade caches**: no other store holds per-id LRU for ProjectStore in the current code; `useProject` uses react-query which invalidates naturally on refetch. No extra invalidation code needed beyond `useQueryClient.invalidateQueries` in T6 mutations. If during T9 a test reveals a stale MissionStore/ArticleStore read, fix inline by passing invalidation callbacks into the route handlers at that point.
- **Spec §4.1–4.3 Frontend**: T6 client/hooks, T7 tabs + menu + ArchivedProjectList, T8 DeleteProjectModal.
- **Spec §5 API contract**: status codes and response bodies match in T3/T4/T5 tests.
- **Spec §7 Acceptance**: archive/restore/destroy dir moves covered by T1/T9; slug-mismatch 400 in T5/T9; tab counts in T7; relative-path preservation implicit via `rename` (no code path re-writes paths).
- **Scope**: 9 tasks, all within ~SP-17 scope (6–8 expected; T9 is a thin E2E and T2 is a small regression that could fold into T1 — kept separate to match the suggested breakdown).
