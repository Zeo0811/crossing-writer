# SP-18 Project Health Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Surface a 7-step health chip row at the top of `ProjectWorkbench` so users see at-a-glance progress, blockers (esp. SP-10 `styleBindings`), and can click to jump to the relevant section. Per-project collapse state persists in localStorage.

**Architecture:** Backend adds `ProjectChecklistService` aggregating `project.json` + `ArticleStore` + SP-10 `resolveStyleBinding` into a fixed 7-item checklist, exposed via `GET /api/projects/:id/checklist`. Frontend adds `ProjectChecklist.tsx` chip row + `useProjectChecklist` hook, mounted at top of `ProjectWorkbench`.

**Tech Stack:** Fastify, React 18, vitest, @testing-library/react, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-18-sp18-project-checklist-design.md`

---

## T1 — `ProjectChecklistService` (web-server)

**Files:**
- Create: `packages/web-server/src/services/project-checklist-service.ts`
- Create: `packages/web-server/tests/project-checklist-service.test.ts`

**Steps:**
1. [ ] Define types in the service file:
   ```ts
   export type ChecklistStatus = "done" | "partial" | "blocked" | "todo" | "warning";
   export type ChecklistStepId =
     | "brief" | "topic" | "case" | "evidence"
     | "styleBindings" | "draft" | "review";
   export interface ChecklistItem {
     step: ChecklistStepId;
     status: ChecklistStatus;
     reason?: string;
     link?: string;
   }
   export interface ProjectChecklist {
     projectId: string;
     items: ChecklistItem[];
     generatedAt: string;
   }
   ```
2. [ ] Export `class ProjectChecklistService` with constructor `(deps: { projectStore: ProjectStore; articleStore: ArticleStore; stylePanelStore: StylePanelStore; agentConfigStore: AgentConfigStore; projectOverrideStore: ProjectOverrideStore })`.
3. [ ] Method `async build(projectId: string): Promise<ProjectChecklist | null>`. Return `null` if `projectStore.get(projectId)` is null (route maps to 404).
4. [ ] Compute items **in order** — one helper per step:
   - `brief`: done when `project.brief !== null` AND `project.status !== "created"`; warning when `project.brief?.md_path` missing (parse failed); else todo. `link: "brief"`.
   - `topic`: done when `project.mission.selected_path !== null`; partial when `project.mission.candidates_path !== null` and not selected; else todo. `link: "mission"`.
   - `case`: done when `project.case_plan?.status === "finalized"`; partial when `=== "draft"`; else todo, reason "案例策划仍为 draft 状态" on partial. `link: "case"`.
   - `evidence`: done when `project.flags?.evidence_skipped === true` OR at least one file under `<projectDir>/evidence/`; else todo with reason "尚未上传素材，也未标记『不需要』". `link: "evidence"`.
   - `styleBindings`: for each role in `["opening","practice","closing"]`, read binding via `agentConfigStore.getBinding(projectId, \`writer.${role}\`)` merged with `projectOverrideStore`, then call `resolveStyleBinding(binding, stylePanelStore)`. If any throws `StyleNotBoundError`, `status: "blocked"`, `reason: \`writer.${role} 缺少 styleBinding（${err.reason}）\``. All resolve → done. `link: "config"`.
   - `draft`: count of `{ opening.md, practice.md, closing.md }` that exist and are non-empty via `articleStore.read(projectId, key)`. 3 → done; 1–2 → partial with reason `\`${n}/3 section 有初稿\``; 0 → todo. `link: "article"`.
   - `review`: done when `project.review?.passed === true` OR file `<projectDir>/style_critic_report.json` exists; warning when draft step is done but review not run (reason "style-critic 未跑"); else todo (downgrade from warning if draft not done). `link: "article"`.
5. [ ] Return `{ projectId, items, generatedAt: new Date().toISOString() }`.
6. [ ] Handle missing `agentConfigStore.getBinding` (agent never configured) same as `StyleNotBoundError` with reason `"missing"`.

**Test code sketch:**
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectChecklistService } from "../src/services/project-checklist-service.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ArticleStore } from "../src/services/article-store.js";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { AgentConfigStore } from "../src/services/agent-config-store.js";
import { ProjectOverrideStore } from "../src/services/project-override-store.js";

function setupRoot() {
  const root = mkdtempSync(join(tmpdir(), "sp18-"));
  mkdirSync(join(root, "projects"), { recursive: true });
  mkdirSync(join(root, "style-panels"), { recursive: true });
  mkdirSync(join(root, "config"), { recursive: true });
  return root;
}

describe("ProjectChecklistService", () => {
  let svc: ProjectChecklistService;
  let projectStore: ProjectStore;
  let root: string;

  beforeEach(async () => {
    root = setupRoot();
    projectStore = new ProjectStore({ root: join(root, "projects") });
    const articleStore = new ArticleStore({ root: join(root, "projects") });
    const stylePanelStore = new StylePanelStore({ root: join(root, "style-panels") });
    const agentConfigStore = new AgentConfigStore({ root: join(root, "config") });
    const projectOverrideStore = new ProjectOverrideStore({ root: join(root, "projects") });
    svc = new ProjectChecklistService({ projectStore, articleStore, stylePanelStore, agentConfigStore, projectOverrideStore });
  });

  it("returns 7 todo items for a freshly created project", async () => {
    const p = await projectStore.create({ name: "fresh" });
    const cl = await svc.build(p.id);
    expect(cl!.items.map(i => i.step)).toEqual([
      "brief","topic","case","evidence","styleBindings","draft","review",
    ]);
    expect(cl!.items.every(i => i.status === "todo" || i.status === "blocked")).toBe(true);
    expect(cl!.items[0]!.status).toBe("todo");
  });

  it("brief done after brief attached", async () => {
    const p = await projectStore.create({ name: "b" });
    await projectStore.update(p.id, (d) => {
      d.status = "brief_ready";
      d.brief = { source_type: "md", raw_path: "x", md_path: "x.md", summary_path: null, uploaded_at: "2026-04-18T00:00:00Z" };
    });
    const cl = await svc.build(p.id);
    expect(cl!.items.find(i => i.step === "brief")!.status).toBe("done");
  });

  it("case partial when plan is draft", async () => {
    const p = await projectStore.create({ name: "c" });
    await projectStore.update(p.id, (d) => {
      (d as any).case_plan = { status: "draft" };
    });
    const cl = await svc.build(p.id);
    const step = cl!.items.find(i => i.step === "case")!;
    expect(step.status).toBe("partial");
    expect(step.reason).toContain("draft");
  });

  it("styleBindings blocked when a writer role has no binding", async () => {
    const p = await projectStore.create({ name: "s" });
    const cl = await svc.build(p.id);
    const step = cl!.items.find(i => i.step === "styleBindings")!;
    expect(step.status).toBe("blocked");
    expect(step.reason).toMatch(/writer\.(opening|practice|closing)/);
  });

  it("draft partial with 1 of 3 sections", async () => {
    const p = await projectStore.create({ name: "d" });
    const openingDir = join(root, "projects", p.slug, "article-store");
    mkdirSync(openingDir, { recursive: true });
    writeFileSync(join(openingDir, "opening.md"), "---\n---\nhello\n");
    const cl = await svc.build(p.id);
    const step = cl!.items.find(i => i.step === "draft")!;
    expect(step.status).toBe("partial");
    expect(step.reason).toContain("1/3");
  });

  it("evidence done when evidence_skipped flag set", async () => {
    const p = await projectStore.create({ name: "e" });
    await projectStore.update(p.id, (d) => { (d as any).flags = { evidence_skipped: true }; });
    const cl = await svc.build(p.id);
    expect(cl!.items.find(i => i.step === "evidence")!.status).toBe("done");
  });

  it("returns null for missing project", async () => {
    expect(await svc.build("p_nope")).toBeNull();
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/project-checklist-service.test.ts`

**Commit:** `sp18(T1): add ProjectChecklistService with 7-step aggregation`

---

## T2 — `GET /api/projects/:id/checklist` route

**Files:**
- Modify: `packages/web-server/src/routes/projects.ts` (add route + accept checklistService in deps)
- Modify: `packages/web-server/src/server.ts` (wire `ProjectChecklistService` into `registerProjectsRoutes`)
- Create: `packages/web-server/tests/projects-checklist-route.test.ts`

**Steps:**
1. [ ] Extend `ProjectsDeps` in `routes/projects.ts`:
   ```ts
   export interface ProjectsDeps {
     store: ProjectStore;
     checklistService: ProjectChecklistService;
   }
   ```
2. [ ] Add route:
   ```ts
   app.get<{ Params: { id: string } }>("/api/projects/:id/checklist", async (req, reply) => {
     const cl = await deps.checklistService.build(req.params.id);
     if (!cl) return reply.code(404).send({ error: "project_not_found" });
     return cl;
   });
   ```
3. [ ] In `server.ts`, construct `ProjectChecklistService` near existing stores and pass into `registerProjectsRoutes`.
4. [ ] Tests use Fastify `inject` + tmpdir fixtures (pattern from existing route tests).

**Test code sketch:**
```ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ArticleStore } from "../src/services/article-store.js";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { AgentConfigStore } from "../src/services/agent-config-store.js";
import { ProjectOverrideStore } from "../src/services/project-override-store.js";
import { ProjectChecklistService } from "../src/services/project-checklist-service.js";

describe("GET /api/projects/:id/checklist", () => {
  let app: ReturnType<typeof Fastify>;
  let store: ProjectStore;

  beforeEach(async () => {
    const root = mkdtempSync(join(tmpdir(), "sp18r-"));
    mkdirSync(join(root, "projects"), { recursive: true });
    store = new ProjectStore({ root: join(root, "projects") });
    const checklistService = new ProjectChecklistService({
      projectStore: store,
      articleStore: new ArticleStore({ root: join(root, "projects") }),
      stylePanelStore: new StylePanelStore({ root: join(root, "style-panels") }),
      agentConfigStore: new AgentConfigStore({ root: join(root, "config") }),
      projectOverrideStore: new ProjectOverrideStore({ root: join(root, "projects") }),
    });
    app = Fastify();
    registerProjectsRoutes(app, { store, checklistService });
  });

  it("happy path — returns 7 items", async () => {
    const p = await store.create({ name: "x" });
    const res = await app.inject({ method: "GET", url: `/api/projects/${p.id}/checklist` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projectId).toBe(p.id);
    expect(body.items).toHaveLength(7);
    expect(typeof body.generatedAt).toBe("string");
  });

  it("404 for unknown project", async () => {
    const res = await app.inject({ method: "GET", url: "/api/projects/p_nope/checklist" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "project_not_found" });
  });

  it("partial state reflects draft case_plan", async () => {
    const p = await store.create({ name: "y" });
    await store.update(p.id, (d) => { (d as any).case_plan = { status: "draft" }; });
    const res = await app.inject({ method: "GET", url: `/api/projects/${p.id}/checklist` });
    const body = res.json();
    const caseStep = body.items.find((i: any) => i.step === "case");
    expect(caseStep.status).toBe("partial");
  });

  it("blocked status surfaces when styleBindings unresolved", async () => {
    const p = await store.create({ name: "z" });
    const res = await app.inject({ method: "GET", url: `/api/projects/${p.id}/checklist` });
    const body = res.json();
    expect(body.items.find((i: any) => i.step === "styleBindings").status).toBe("blocked");
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/projects-checklist-route.test.ts`

**Commit:** `sp18(T2): expose GET /api/projects/:id/checklist`

---

## T3 — `ProjectChecklist.tsx` component

**Files:**
- Create: `packages/web-ui/src/components/project/ProjectChecklist.tsx`
- Create: `packages/web-ui/src/components/project/ProjectChecklist.module.css`
- Create: `packages/web-ui/src/components/project/__tests__/ProjectChecklist.test.tsx`

**Steps:**
1. [ ] Component signature:
   ```tsx
   export interface ProjectChecklistProps {
     items: ChecklistItem[];
     collapsed?: boolean;
     onToggleCollapsed?: () => void;
     onChipClick?: (item: ChecklistItem) => void;
   }
   ```
   Export type aliases identical to backend (`ChecklistItem`, `ChecklistStatus`, `ChecklistStepId`).
2. [ ] Render horizontal row of chips. Each chip:
   - `data-testid={\`checklist-chip-${item.step}\`}`
   - `data-status={item.status}`
   - Icon mapping: `done:●`, `partial:◐`, `todo:○`, `warning:▣`, `blocked:◉`.
   - Chinese label map: `brief:选题简报`, `topic:主题选定`, `case:案例策划`, `evidence:素材`, `styleBindings:风格绑定`, `draft:初稿`, `review:评审`.
   - Tooltip via `title={item.reason}` plus a hidden `<span role="tooltip">` for RTL test targeting.
   - `onClick={() => onChipClick?.(item)}`.
3. [ ] Collapsed view: render a single pill `<button data-testid="checklist-summary">N/7 已完成</button>` counting `status==="done"` items, plus the toggle.
4. [ ] Toggle button at right end: `▲ 折叠` when expanded, `▼ 展开` when collapsed. `data-testid="checklist-toggle"`.
5. [ ] CSS uses SP-14 tokens only: `var(--surface-muted)`, `var(--accent-danger)`, `var(--accent-warning)`, `var(--accent-success)`, `var(--text-muted)`, `var(--border)`. No raw hex.

**Test code sketch:**
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectChecklist, type ChecklistItem } from "../ProjectChecklist";

const ITEMS: ChecklistItem[] = [
  { step: "brief", status: "done", link: "brief" },
  { step: "topic", status: "todo", link: "mission" },
  { step: "case", status: "partial", reason: "draft 状态", link: "case" },
  { step: "evidence", status: "todo", link: "evidence" },
  { step: "styleBindings", status: "blocked", reason: "writer.practice 缺少 styleBinding", link: "config" },
  { step: "draft", status: "todo", link: "article" },
  { step: "review", status: "todo", link: "article" },
];

describe("ProjectChecklist", () => {
  it("renders all 7 chips with correct data-status", () => {
    render(<ProjectChecklist items={ITEMS} />);
    for (const it of ITEMS) {
      const chip = screen.getByTestId(`checklist-chip-${it.step}`);
      expect(chip.getAttribute("data-status")).toBe(it.status);
    }
  });

  it("shows reason via title attribute", () => {
    render(<ProjectChecklist items={ITEMS} />);
    expect(screen.getByTestId("checklist-chip-styleBindings").getAttribute("title"))
      .toContain("writer.practice");
  });

  it("fires onChipClick with the item payload", () => {
    const onChipClick = vi.fn();
    render(<ProjectChecklist items={ITEMS} onChipClick={onChipClick} />);
    fireEvent.click(screen.getByTestId("checklist-chip-case"));
    expect(onChipClick).toHaveBeenCalledWith(expect.objectContaining({ step: "case", link: "case" }));
  });

  it("collapsed view shows summary pill and no chips", () => {
    render(<ProjectChecklist items={ITEMS} collapsed />);
    expect(screen.getByTestId("checklist-summary").textContent).toContain("1/7");
    expect(screen.queryByTestId("checklist-chip-brief")).toBeNull();
  });

  it("toggle button triggers onToggleCollapsed", () => {
    const onToggle = vi.fn();
    render(<ProjectChecklist items={ITEMS} onToggleCollapsed={onToggle} />);
    fireEvent.click(screen.getByTestId("checklist-toggle"));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
```

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run src/components/project/__tests__/ProjectChecklist.test.tsx`

**Commit:** `sp18(T3): add ProjectChecklist chip row component`

---

## T4 — API client + `useProjectChecklist` hook

**Files:**
- Modify: `packages/web-ui/src/api/client.ts` (add `getProjectChecklist`, export `ChecklistItem` / `ProjectChecklist` types)
- Create: `packages/web-ui/src/hooks/useProjectChecklist.ts`
- Create: `packages/web-ui/src/hooks/__tests__/useProjectChecklist.test.tsx`

**Steps:**
1. [ ] Add to `client.ts`:
   ```ts
   export type ChecklistStatus = "done"|"partial"|"blocked"|"todo"|"warning";
   export type ChecklistStepId = "brief"|"topic"|"case"|"evidence"|"styleBindings"|"draft"|"review";
   export interface ChecklistItem { step: ChecklistStepId; status: ChecklistStatus; reason?: string; link?: string }
   export interface ProjectChecklist { projectId: string; items: ChecklistItem[]; generatedAt: string }

   export async function getProjectChecklist(projectId: string): Promise<ProjectChecklist> {
     const res = await fetch(`/api/projects/${projectId}/checklist`);
     if (!res.ok) throw new Error(`checklist fetch failed: ${res.status}`);
     return res.json();
   }
   ```
2. [ ] Hook `useProjectChecklist(projectId: string)` — no React Query; uses `useState` + `useEffect` consistent with existing hooks (e.g. `useBriefSummary`). Returns `{ data, loading, error, refetch }`.
3. [ ] Subscribe to `useProjectStream(projectId)` — on each SSE event whose `type` is in the set `["project.updated","brief.ready","mission.selected","case.finalized","evidence.updated","article.section.written","style.binding.updated"]`, call `refetch()`.
4. [ ] Initial fetch on mount + whenever `projectId` changes; abort in-flight fetch on unmount with `AbortController`.

**Test code sketch:**
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useProjectChecklist } from "../useProjectChecklist";

vi.mock("../useProjectStream", () => ({
  useProjectStream: () => ({ lastEvent: null }),
}));

describe("useProjectChecklist", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        projectId: "p1",
        items: [{ step: "brief", status: "done" }],
        generatedAt: "2026-04-18T00:00:00Z",
      }),
    })) as any;
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("fetches on mount", async () => {
    const { result } = renderHook(() => useProjectChecklist("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.items[0]?.step).toBe("brief");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/projects/p1/checklist", expect.anything());
  });

  it("refetch re-invokes fetch", async () => {
    const { result } = renderHook(() => useProjectChecklist("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.refetch(); });
    expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces error on non-2xx", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as any;
    const { result } = renderHook(() => useProjectChecklist("p1"));
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });
});
```

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run src/hooks/__tests__/useProjectChecklist.test.tsx`

**Commit:** `sp18(T4): add getProjectChecklist client + useProjectChecklist hook`

---

## T5 — Mount in `ProjectWorkbench` + click-to-jump

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx`
- Modify: `packages/web-ui/src/pages/__tests__/ProjectWorkbench.test.tsx` (or create if absent)

**Steps:**
1. [ ] Import `ProjectChecklist` and `useProjectChecklist`.
2. [ ] Call `const { data: checklist } = useProjectChecklist(projectId)` in the component.
3. [ ] Render `<ProjectChecklist items={checklist?.items ?? []} onChipClick={handleChipClick} collapsed={collapsed} onToggleCollapsed={toggle} />` immediately under `<TopNav />`, above the existing section accordion.
4. [ ] `handleChipClick(item)` maps `item.link` to the existing section router — use the `SECTION_ORDER` key list (`brief | mission | overview | case | evidence | article`). Checklist `link` values are already aligned; special-case `config` → open `SettingsDrawer` (set `settingsOpen=true`). After mapping call existing `scrollToSection(key)` helper (add if not already present: `document.querySelector(\`[data-section="${key}"]\`)?.scrollIntoView({ behavior: "smooth" })`).
5. [ ] Ensure each existing section wrapper has `data-section="<key>"` attribute; add the attributes where missing.

**Test code sketch:**
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectWorkbench from "../ProjectWorkbench";

vi.mock("../../api/client", () => ({
  getProject: vi.fn(async () => ({ id: "p1", name: "x", status: "created" })),
  getProjectChecklist: vi.fn(async () => ({
    projectId: "p1",
    generatedAt: "2026-04-18T00:00:00Z",
    items: [
      { step: "brief", status: "done", link: "brief" },
      { step: "topic", status: "todo", link: "mission" },
      { step: "case", status: "todo", link: "case" },
      { step: "evidence", status: "todo", link: "evidence" },
      { step: "styleBindings", status: "blocked", reason: "r", link: "config" },
      { step: "draft", status: "todo", link: "article" },
      { step: "review", status: "todo", link: "article" },
    ],
  })),
}));
vi.mock("../../hooks/useProjectStream", () => ({ useProjectStream: () => ({ lastEvent: null }) }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/p1"]}>
      <Routes><Route path="/projects/:projectId" element={<ProjectWorkbench />} /></Routes>
    </MemoryRouter>,
  );
}

describe("ProjectWorkbench + checklist", () => {
  it("renders checklist under top nav", async () => {
    renderPage();
    const chip = await screen.findByTestId("checklist-chip-brief");
    expect(chip).toBeInTheDocument();
  });

  it("clicking a chip scrolls to the matching section", async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    renderPage();
    const chip = await screen.findByTestId("checklist-chip-case");
    fireEvent.click(chip);
    expect(spy).toHaveBeenCalled();
  });
});
```

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run src/pages/__tests__/ProjectWorkbench.test.tsx`

**Commit:** `sp18(T5): mount ProjectChecklist in ProjectWorkbench with click-to-jump`

---

## T6 — Collapse toggle with per-project localStorage persistence

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx`
- Modify: `packages/web-ui/src/pages/__tests__/ProjectWorkbench.test.tsx` (add cases)

**Steps:**
1. [ ] Add state:
   ```ts
   const storageKey = `checklist_collapsed_${projectId}`;
   const [collapsed, setCollapsed] = useState<boolean>(() => {
     try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
   });
   const toggle = useCallback(() => {
     setCollapsed((c) => {
       const next = !c;
       try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch {}
       return next;
     });
   }, [storageKey]);
   ```
2. [ ] Reset `collapsed` when `projectId` changes (read the new key).
3. [ ] Pass `collapsed` + `toggle` to `<ProjectChecklist>`.

**Test code sketch:**
```tsx
it("persists collapsed state per projectId", async () => {
  renderPage();
  const toggle = await screen.findByTestId("checklist-toggle");
  fireEvent.click(toggle);
  expect(localStorage.getItem("checklist_collapsed_p1")).toBe("1");
  expect(screen.getByTestId("checklist-summary")).toBeInTheDocument();
});

it("restores collapsed state from localStorage on mount", async () => {
  localStorage.setItem("checklist_collapsed_p1", "1");
  renderPage();
  expect(await screen.findByTestId("checklist-summary")).toBeInTheDocument();
  expect(screen.queryByTestId("checklist-chip-brief")).toBeNull();
});

it("scopes collapse per project", async () => {
  localStorage.setItem("checklist_collapsed_p1", "1");
  localStorage.setItem("checklist_collapsed_p2", "0");
  // re-render with p2 route in a separate MemoryRouter
  render(
    <MemoryRouter initialEntries={["/projects/p2"]}>
      <Routes><Route path="/projects/:projectId" element={<ProjectWorkbench />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByTestId("checklist-chip-brief")).toBeInTheDocument();
});
```

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run src/pages/__tests__/ProjectWorkbench.test.tsx`

**Commit:** `sp18(T6): persist ProjectChecklist collapse per projectId`

---

## T7 — Theme polish with SP-14 tokens

**Files:**
- Modify: `packages/web-ui/src/components/project/ProjectChecklist.module.css`
- Modify: `packages/web-ui/src/components/project/__tests__/ProjectChecklist.test.tsx`

**Steps:**
1. [ ] Audit CSS: replace any literal colors with SP-14 tokens. Status variants:
   - `[data-status="done"]` → `color: var(--accent-success)`, `background: var(--surface-muted)`.
   - `[data-status="blocked"]` → `color: var(--accent-danger)`, `border-color: var(--accent-danger)`.
   - `[data-status="warning"]` → `color: var(--accent-warning)`.
   - `[data-status="partial"]` → `color: var(--accent-info)`.
   - `[data-status="todo"]` → `color: var(--text-muted)`.
2. [ ] Ensure component respects `:root[data-theme="dark"]` by relying only on tokens (no hard-coded `#fff` / `#000`).
3. [ ] Add a `.chip:hover { background: var(--surface-hover); }` rule.

**Test code sketch:**
```tsx
it("chip styles use SP-14 tokens in dark theme", () => {
  document.documentElement.setAttribute("data-theme", "dark");
  render(<ProjectChecklist items={ITEMS} />);
  const blocked = screen.getByTestId("checklist-chip-styleBindings");
  const style = getComputedStyle(blocked);
  // jsdom won't resolve CSS vars, so assert class + data-status, not color
  expect(blocked.getAttribute("data-status")).toBe("blocked");
  expect(blocked.className).toMatch(/chip/);
  document.documentElement.removeAttribute("data-theme");
});

it("chip className does not embed raw hex color", async () => {
  const css = await import("node:fs").then(fs =>
    fs.readFileSync(
      new URL("../ProjectChecklist.module.css", import.meta.url),
      "utf-8",
    ),
  );
  expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  expect(css).toMatch(/var\(--accent-danger\)/);
  expect(css).toMatch(/var\(--accent-success\)/);
});
```

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run src/components/project/__tests__/ProjectChecklist.test.tsx`

**Commit:** `sp18(T7): use SP-14 tokens for checklist chip colors`

---

## T8 — E2E Playwright coverage

**Files:**
- Create: `e2e/tests/project-checklist.spec.ts`
- Modify: `e2e/fixtures/mocks.ts` (add checklist mock helper) — if the file doesn't exist, create following the pattern used by existing specs.

**Steps:**
1. [ ] Spec boots the web app with `page.route("**/api/projects/*/checklist", ...)` returning the mixed-status payload from T3.
2. [ ] Also mock `GET /api/projects/p1` with a minimal project payload so `ProjectWorkbench` renders.
3. [ ] Assert all 7 chips visible with expected `data-status`.
4. [ ] Click the `case` chip → assert URL hash / scroll landed on `[data-section="case"]` (use `toBeInViewport`).
5. [ ] Click the `styleBindings` chip → assert settings drawer opens (e.g. `[data-testid="settings-drawer"]` visible).
6. [ ] Click toggle → assert `checklist-summary` visible and chips hidden; reload page; still collapsed (localStorage persisted).

**Test code sketch:**
```ts
import { test, expect } from "@playwright/test";

const CHECKLIST = {
  projectId: "p1",
  generatedAt: "2026-04-18T00:00:00Z",
  items: [
    { step: "brief", status: "done", link: "brief" },
    { step: "topic", status: "todo", link: "mission" },
    { step: "case", status: "partial", reason: "draft", link: "case" },
    { step: "evidence", status: "todo", link: "evidence" },
    { step: "styleBindings", status: "blocked", reason: "writer.practice 缺少 styleBinding", link: "config" },
    { step: "draft", status: "todo", link: "article" },
    { step: "review", status: "todo", link: "article" },
  ],
};

test.describe("SP-18 project checklist", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/projects/p1/checklist", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CHECKLIST) }));
    await page.route("**/api/projects/p1", (r) =>
      r.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ id: "p1", name: "t", status: "created" }) }));
  });

  test("renders all 7 chips with correct classes", async ({ page }) => {
    await page.goto("/projects/p1");
    for (const it of CHECKLIST.items) {
      const chip = page.getByTestId(`checklist-chip-${it.step}`);
      await expect(chip).toBeVisible();
      await expect(chip).toHaveAttribute("data-status", it.status);
    }
  });

  test("click case chip scrolls to section", async ({ page }) => {
    await page.goto("/projects/p1");
    await page.getByTestId("checklist-chip-case").click();
    await expect(page.locator('[data-section="case"]')).toBeInViewport();
  });

  test("blocked styleBindings chip opens settings drawer", async ({ page }) => {
    await page.goto("/projects/p1");
    await page.getByTestId("checklist-chip-styleBindings").click();
    await expect(page.getByTestId("settings-drawer")).toBeVisible();
  });

  test("collapse state persists across reload per project", async ({ page }) => {
    await page.goto("/projects/p1");
    await page.getByTestId("checklist-toggle").click();
    await expect(page.getByTestId("checklist-summary")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("checklist-summary")).toBeVisible();
    await expect(page.getByTestId("checklist-chip-brief")).toHaveCount(0);
  });
});
```

**Verify:** `pnpm --filter @crossing/e2e exec playwright test tests/project-checklist.spec.ts`

**Commit:** `sp18(T8): e2e coverage for project checklist chips + persistence`

---

## Acceptance (from spec §6)

- [ ] New project: 7 chips, `brief` highlighted with todo reason, others todo (styleBindings may be blocked if writer.* unbound).
- [ ] After brief uploaded: `brief` → done.
- [ ] `case_plan` draft → `case` → partial with tooltip `draft 状态`.
- [ ] Missing writer.* binding → `styleBindings` blocked with SP-10 reason.
- [ ] Only `opening.md` present → `draft` partial with `1/3`.
- [ ] Click any chip navigates to the correct tab/section.
- [ ] Collapse persists per project across reload (`checklist_collapsed_<projectId>`).
- [ ] `GET /api/projects/:id/checklist` p95 < 200ms locally.
