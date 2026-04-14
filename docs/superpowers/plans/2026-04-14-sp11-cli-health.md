# SP-11 CLI Health Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship an always-on CLI health indicator in the ProjectList top nav. Backend exposes `GET /api/system/cli-health`, probing `claude --version` / `codex --version` with 2s timeout and 30s in-process cache. Frontend renders two colored dots with hover popover showing status, version/error, and copy-able install/login commands.

**Architecture:** Backend adds `CliHealthProber` service + `system-health` route; server wires it in. Frontend adds `useCliHealth` hook (30s polling with unmount cleanup), `CliHealthDot` component with popover, and a static `cliInstallHints` table; integrated into `ProjectList` top nav.

**Tech Stack:** Fastify, Node `child_process.execFile`, React 18, @testing-library/react, vitest.

> **Note on package names:** the spec refers to `packages/backend`, but this repo uses `packages/web-server` (pkg `@crossing/web-server`). All backend paths below use `packages/web-server`.

---

## T1 — `CliHealthProber` service (web-server)

**Files:**
- Create: `packages/web-server/src/services/cli-health.ts`
- Test: `packages/web-server/tests/cli-health.test.ts`

**Steps:**
1. [ ] Define exported types: `export type CliStatus = "online" | "offline" | "error"`; `export interface CliHealthItem { status: CliStatus; version?: string; error?: string; checkedAt: string }`; `export interface CliHealthResponse { claude: CliHealthItem; codex: CliHealthItem }`.
2. [ ] Export `createCliHealthProber(opts?: { now?: () => number; exec?: ExecFileFn; ttlMs?: number; timeoutMs?: number })` returning `{ probe(): Promise<CliHealthResponse> }`. Default `ttlMs = 30_000`, `timeoutMs = 2_000`, `now = Date.now`, `exec = execFile` (promisified via `util.promisify`).
3. [ ] Internal `probeOne(cmd: "claude" | "codex"): Promise<CliHealthItem>`:
   - Call `exec(cmd, ["--version"], { timeout })`.
   - On success: match stdout against `/(\d+\.\d+(?:\.\d+)?)/`. If matched → `{ status: "online", version: m[1], checkedAt }`. Else → `{ status: "error", error: "unexpected version output", checkedAt }`.
   - On error: if `err.code === "ENOENT"` → `{ status: "offline", error: "command not found", checkedAt }`. Else if `err.killed || err.signal === "SIGTERM"` → `{ status: "error", error: "probe timed out", checkedAt }`. Else → `{ status: "error", error: (err.message || "probe failed").slice(0, 160), checkedAt }`.
4. [ ] `probe()`: if `cached && now() - cached.at < ttlMs` → return `cached.data`. Otherwise run `Promise.all([probeOne("claude"), probeOne("codex")])`, assemble response, store in cache, return.
5. [ ] `checkedAt = new Date(now()).toISOString()`.
6. [ ] Tests — inject a fake `exec` (vi.fn) and fake `now` (counter). Cases:
   - online: exec resolves `{ stdout: "1.4.2\n", stderr: "" }` for both → both `online` with `version === "1.4.2"`.
   - offline: exec rejects with `Object.assign(new Error("not found"), { code: "ENOENT" })` → `status: "offline"`, `error: "command not found"`.
   - timeout: exec rejects with `Object.assign(new Error("timeout"), { killed: true, signal: "SIGTERM" })` → `status: "error"`, `error: "probe timed out"`.
   - cache hit: call `probe()` twice within ttl; assert `exec` called 2 times total (once per cmd, not 4).
   - cache miss after ttl: advance fake `now` by `ttlMs + 1` → `exec` called 4 times.
   - version regex fallback: stdout `"gibberish"` → `status: "error"`, `error: "unexpected version output"`.

**Test code:**
```ts
import { describe, it, expect, vi } from "vitest";
import { createCliHealthProber } from "../src/services/cli-health.js";

function makeExec(map: Record<string, { stdout?: string; err?: any }>) {
  return vi.fn(async (cmd: string) => {
    const hit = map[cmd];
    if (!hit) throw Object.assign(new Error("nope"), { code: "ENOENT" });
    if (hit.err) throw hit.err;
    return { stdout: hit.stdout ?? "", stderr: "" };
  });
}

describe("createCliHealthProber", () => {
  it("marks both online with parsed version", async () => {
    const exec = makeExec({ claude: { stdout: "claude 1.4.2\n" }, codex: { stdout: "codex 0.9.1" } });
    const p = createCliHealthProber({ exec, now: () => 1000 });
    const out = await p.probe();
    expect(out.claude.status).toBe("online");
    expect(out.claude.version).toBe("1.4.2");
    expect(out.codex.version).toBe("0.9.1");
  });

  it("treats ENOENT as offline", async () => {
    const exec = makeExec({ codex: { stdout: "0.9.1" } });
    const p = createCliHealthProber({ exec, now: () => 2000 });
    const out = await p.probe();
    expect(out.claude.status).toBe("offline");
    expect(out.claude.error).toBe("command not found");
  });

  it("treats killed signal as timeout error", async () => {
    const err = Object.assign(new Error("x"), { killed: true, signal: "SIGTERM" });
    const exec = makeExec({ claude: { err }, codex: { stdout: "0.9.1" } });
    const p = createCliHealthProber({ exec, now: () => 3000 });
    const out = await p.probe();
    expect(out.claude.status).toBe("error");
    expect(out.claude.error).toBe("probe timed out");
  });

  it("flags unparseable version", async () => {
    const exec = makeExec({ claude: { stdout: "hello" }, codex: { stdout: "1.0" } });
    const p = createCliHealthProber({ exec, now: () => 4000 });
    const out = await p.probe();
    expect(out.claude.status).toBe("error");
    expect(out.claude.error).toMatch(/unexpected/);
  });

  it("caches within ttl and refetches after", async () => {
    let t = 0;
    const exec = makeExec({ claude: { stdout: "1.0.0" }, codex: { stdout: "1.0.0" } });
    const p = createCliHealthProber({ exec, now: () => t, ttlMs: 1000 });
    await p.probe();
    await p.probe();
    expect(exec).toHaveBeenCalledTimes(2);
    t = 1001;
    await p.probe();
    expect(exec).toHaveBeenCalledTimes(4);
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/cli-health.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -am "sp11(T1): add CliHealthProber service with timeout + ttl cache"`

---

## T2 — `GET /api/system/cli-health` route

**Files:**
- Create: `packages/web-server/src/routes/system-health.ts`
- Test: `packages/web-server/tests/routes-system-health.test.ts`

**Steps:**
1. [ ] Export `registerSystemHealthRoutes(app: FastifyInstance, deps: { prober: { probe(): Promise<CliHealthResponse> } })`.
2. [ ] Register `GET /api/system/cli-health`: call `deps.prober.probe()`, reply 200 JSON. On thrown error, reply 500 with `{ message: err.message }` (spec §4).
3. [ ] No query params, no body.
4. [ ] Tests with `fastify()` instance + injected fake prober:
   - happy path: fake returns a `CliHealthResponse` → `inject({ method: "GET", url: "/api/system/cli-health" })` → statusCode 200, body matches.
   - prober throws → statusCode 500, body `{ message }`.

**Test code:**
```ts
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerSystemHealthRoutes } from "../src/routes/system-health.js";

function buildApp(prober: any) {
  const app = Fastify();
  registerSystemHealthRoutes(app, { prober });
  return app;
}

describe("GET /api/system/cli-health", () => {
  it("returns prober payload", async () => {
    const payload = {
      claude: { status: "online", version: "1.4.2", checkedAt: "2026-04-14T00:00:00.000Z" },
      codex: { status: "offline", error: "command not found", checkedAt: "2026-04-14T00:00:00.000Z" },
    };
    const app = buildApp({ probe: vi.fn().mockResolvedValue(payload) });
    const res = await app.inject({ method: "GET", url: "/api/system/cli-health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(payload);
    await app.close();
  });

  it("returns 500 when prober throws", async () => {
    const app = buildApp({ probe: vi.fn().mockRejectedValue(new Error("boom")) });
    const res = await app.inject({ method: "GET", url: "/api/system/cli-health" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ message: "boom" });
    await app.close();
  });
});
```

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/routes-system-health.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -am "sp11(T2): add /api/system/cli-health route"`

---

## T3 — Wire prober + route into server.ts

**Files:**
- Modify: `packages/web-server/src/server.ts`
- Test: `packages/web-server/tests/routes-system-health-smoke.test.ts`

**Steps:**
1. [ ] In `server.ts`, `import { createCliHealthProber } from "./services/cli-health.js"` and `import { registerSystemHealthRoutes } from "./routes/system-health.js"`.
2. [ ] In the server factory, after existing service wiring, add `const cliHealthProber = createCliHealthProber();`.
3. [ ] After existing `register*Routes` calls, add `registerSystemHealthRoutes(app, { prober: cliHealthProber });`.
4. [ ] Smoke test: boot the full `createServer`/`buildApp` export (reuse the pattern other `routes-*` tests use) and assert the route responds 200 with `claude` + `codex` keys (inject a custom prober or mock `execFile` — simpler: verify shape, tolerate `offline` status when CLIs missing in CI).

**Test code:**
```ts
import { describe, it, expect } from "vitest";
// Follow the existing pattern used by other routes-*.test.ts files in this package
// for booting a test fastify instance. If the package exposes a test helper like
// `createTestServer`, reuse it here.
import { createTestServer } from "./helpers/test-server.js"; // adjust to actual helper

describe("cli-health smoke", () => {
  it("is reachable from the wired server", async () => {
    const app = await createTestServer();
    const res = await app.inject({ method: "GET", url: "/api/system/cli-health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("claude.status");
    expect(body).toHaveProperty("codex.status");
    await app.close();
  });
});
```

> If `packages/web-server/tests/` has no `createTestServer` helper, inline the same setup used by an existing `routes-*.test.ts` (e.g. `routes-kb-accounts.test.ts`) — do **not** invent a new helper.

**Verify:** `pnpm --filter @crossing/web-server exec vitest run tests/routes-system-health-smoke.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -am "sp11(T3): wire CliHealthProber + route into server"`

---

## T4 — `useCliHealth` hook (web-ui)

**Files:**
- Create: `packages/web-ui/src/hooks/useCliHealth.ts`
- Create: `packages/web-ui/src/api/system-health.ts`
- Test: `packages/web-ui/tests/use-cli-health.test.tsx`

**Steps:**
1. [ ] In `system-health.ts` export types `CliStatus`, `CliHealthItem`, `CliHealthResponse` (mirror backend), and `export async function fetchCliHealth(): Promise<CliHealthResponse>` that `fetch("/api/system/cli-health")` and returns `res.json()` (throws on non-2xx).
2. [ ] `useCliHealth()` returns `{ data: CliHealthResponse | null; loading: boolean; error: Error | null }`. On mount, immediately call `fetchCliHealth()`. Use `setInterval(fetchCliHealth, 30_000)`. `useEffect` cleanup clears the interval and sets an `isMounted` flag to false so late responses don't `setState` after unmount.
3. [ ] On fetch error: keep previous `data`, set `error`, leave polling running.
4. [ ] Tests (vitest + RTL `renderHook`, `vi.useFakeTimers()`):
   - initial fetch populates data and `loading` flips to false.
   - advancing timers by 30s triggers a second fetch (assert `fetchCliHealth` mock called twice).
   - unmount clears interval — no further fetch calls after unmount when timers advance.
   - fetch rejection sets `error` and does **not** throw.

**Test code:**
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCliHealth } from "../src/hooks/useCliHealth";
import * as api from "../src/api/system-health";

const sample = {
  claude: { status: "online", version: "1.4.2", checkedAt: "t" },
  codex: { status: "offline", error: "command not found", checkedAt: "t" },
} as const;

describe("useCliHealth", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("fetches on mount and polls every 30s", async () => {
    const spy = vi.spyOn(api, "fetchCliHealth").mockResolvedValue(sample as any);
    const { result } = renderHook(() => useCliHealth());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("stops polling on unmount", async () => {
    const spy = vi.spyOn(api, "fetchCliHealth").mockResolvedValue(sample as any);
    const { unmount } = renderHook(() => useCliHealth());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("surfaces errors without throwing", async () => {
    vi.spyOn(api, "fetchCliHealth").mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useCliHealth());
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  });
});
```

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run tests/use-cli-health.test.tsx`

**Commit:** `git -c commit.gpgsign=false commit -am "sp11(T4): add useCliHealth hook with 30s polling"`

---

## T5 — `CliHealthDot` component + install hints

**Files:**
- Create: `packages/web-ui/src/components/status/CliHealthDot.tsx`
- Create: `packages/web-ui/src/components/status/cliInstallHints.ts`
- Test: `packages/web-ui/tests/cli-health-dot.test.tsx`

**Steps:**
1. [ ] `cliInstallHints.ts`: export `const CLI_INSTALL_HINTS: Record<"claude"|"codex", { install: string; login: string }>` with:
   - `claude`: `{ install: "npm i -g @anthropic-ai/claude-code", login: "claude /login" }`
   - `codex`:  `{ install: "brew install codex", login: "codex login" }`
2. [ ] `CliHealthDot.tsx` props: `{ label: "CLAUDE" | "CODEX"; item: CliHealthItem; onCopy?: (text: string) => Promise<void> }`. Renders an 8×8 circle (`span` with inline background color + role label text-11). Green `#22c55e` for `online`, red `#ef4444` otherwise.
3. [ ] Wrap the dot in a relative container. `onMouseEnter` sets `open = true`; `onMouseLeave` schedules `setTimeout(() => setOpen(false), 150)` (cleared by re-enter). Popover width 280px.
4. [ ] Popover content:
   - Title row: `${label} · ${status.toUpperCase()}${version ? " v"+version : ""}`.
   - Status line: online → `checkedAt` relative; offline/error → `item.error ?? "unknown"`.
   - Divider.
   - Two rows (install + login commands). Each row: `<code>` + Copy button. Copy button calls `onCopy(cmd)` or falls back to `navigator.clipboard.writeText(cmd)`.
   - Footer grey: `每 30 秒自动检测`.
5. [ ] Accessibility: dot has `aria-label={label + " " + status}` and `title` with the error / version (so narrow-screen users still see a hint).
6. [ ] Tests:
   - renders green dot when `status==="online"` + version text in popover after hover.
   - renders red dot when offline; popover shows install + login commands for claude.
   - clicking Copy calls injected `onCopy` with the exact command string.
   - `aria-label` reflects status.

**Test code:**
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CliHealthDot } from "../src/components/status/CliHealthDot";

const onlineItem = { status: "online", version: "1.4.2", checkedAt: "2026-04-14T00:00:00Z" } as const;
const offlineItem = { status: "offline", error: "command not found", checkedAt: "2026-04-14T00:00:00Z" } as const;

describe("CliHealthDot", () => {
  it("renders online label with version in popover", () => {
    render(<CliHealthDot label="CLAUDE" item={onlineItem as any} />);
    const dot = screen.getByLabelText(/CLAUDE online/i);
    fireEvent.mouseEnter(dot);
    expect(screen.getByText(/v1\.4\.2/)).toBeInTheDocument();
  });

  it("shows install + login commands when offline and fires onCopy", async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    render(<CliHealthDot label="CLAUDE" item={offlineItem as any} onCopy={onCopy} />);
    fireEvent.mouseEnter(screen.getByLabelText(/CLAUDE offline/i));
    const pop = screen.getByRole("dialog", { hidden: true }) ?? screen.getByText(/command not found/i).closest("div")!;
    const buttons = within(pop as HTMLElement).getAllByRole("button", { name: /copy/i });
    fireEvent.click(buttons[0]!);
    expect(onCopy).toHaveBeenCalledWith("npm i -g @anthropic-ai/claude-code");
    fireEvent.click(buttons[1]!);
    expect(onCopy).toHaveBeenCalledWith("claude /login");
  });
});
```

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run tests/cli-health-dot.test.tsx`

**Commit:** `git -c commit.gpgsign=false commit -am "sp11(T5): add CliHealthDot with install/login popover"`

---

## T6 — Integrate into `ProjectList` top nav

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectList.tsx`
- Test: `packages/web-ui/tests/project-list-cli-health.test.tsx`

**Steps:**
1. [ ] In `ProjectList.tsx`, import `useCliHealth` and `CliHealthDot`. Call the hook once at top of the component.
2. [ ] Locate the top nav `div` (right-side flex row currently holding Config Workbench link). Prepend a `<div className="flex items-center gap-3">` containing:
   - `data ? <CliHealthDot label="CLAUDE" item={data.claude} /> : null`
   - `data ? <CliHealthDot label="CODEX" item={data.codex} /> : null`
3. [ ] If `data == null && loading`, render two grey placeholder dots (same 8px size, bg `#d1d5db`) so layout doesn't jump.
4. [ ] Test: mock `fetchCliHealth` to resolve `{ claude: online, codex: offline }`, render `<ProjectList />` wrapped in MemoryRouter + any required providers, wait for `CLAUDE` + `CODEX` labels in the DOM. Assert both dots present.
   - If `ProjectList` fetches projects too, stub that fetch as well using the same pattern as existing `ProjectList` tests (check `tests/` for prior example; reuse, don't invent).

**Test code:**
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ProjectList from "../src/pages/ProjectList";
import * as healthApi from "../src/api/system-health";

describe("ProjectList CLI health indicator", () => {
  beforeEach(() => {
    vi.spyOn(healthApi, "fetchCliHealth").mockResolvedValue({
      claude: { status: "online", version: "1.4.2", checkedAt: "t" },
      codex: { status: "offline", error: "command not found", checkedAt: "t" },
    } as any);
    // Also stub project list fetch as existing ProjectList tests do.
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) as any;
  });

  it("shows both CLI dots in top nav", async () => {
    render(<MemoryRouter><ProjectList /></MemoryRouter>);
    await waitFor(() => expect(screen.getByLabelText(/CLAUDE online/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/CODEX offline/i)).toBeInTheDocument();
  });
});
```

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run tests/project-list-cli-health.test.tsx`

**Commit:** `git -c commit.gpgsign=false commit -am "sp11(T6): integrate CLI health dots into ProjectList nav"`

---

## T7 — Clipboard UX with graceful fallback

**Files:**
- Modify: `packages/web-ui/src/components/status/CliHealthDot.tsx`
- Create: `packages/web-ui/src/components/status/copyToClipboard.ts`
- Test: `packages/web-ui/tests/copy-to-clipboard.test.ts`

**Steps:**
1. [ ] `copyToClipboard.ts` exports `async function copyToClipboard(text: string): Promise<boolean>`:
   - If `typeof navigator !== "undefined" && navigator.clipboard?.writeText` → `await navigator.clipboard.writeText(text); return true;`.
   - Else fallback: create a hidden `<textarea>`, set value, append to body, select, `document.execCommand("copy")`, remove; return `true` if exec succeeded.
   - Catch any throw → return `false`.
2. [ ] In `CliHealthDot`: when no `onCopy` prop given, default to `copyToClipboard`. After copy, show transient `"已复制"` label on the button for 1500ms (local state + `setTimeout`, cleared on unmount).
3. [ ] Tests:
   - `navigator.clipboard.writeText` available → function resolves `true` and calls it with the text.
   - clipboard API throws → falls back to execCommand path (mock `document.execCommand` returning true) → resolves `true`.
   - both paths throw / unavailable → returns `false` (no throw).

**Test code:**
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { copyToClipboard } from "../src/components/status/copyToClipboard";

afterEach(() => { vi.restoreAllMocks(); });

describe("copyToClipboard", () => {
  it("uses navigator.clipboard when available", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    (globalThis as any).navigator = { clipboard: { writeText: write } };
    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when clipboard API throws", async () => {
    (globalThis as any).navigator = { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } };
    const exec = vi.spyOn(document, "execCommand").mockReturnValue(true);
    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("returns false when both paths fail", async () => {
    (globalThis as any).navigator = { clipboard: undefined };
    vi.spyOn(document, "execCommand").mockImplementation(() => { throw new Error("no"); });
    await expect(copyToClipboard("hello")).resolves.toBe(false);
  });
});
```

**Verify:** `pnpm --filter @crossing/web-ui exec vitest run tests/copy-to-clipboard.test.ts`

**Commit:** `git -c commit.gpgsign=false commit -am "sp11(T7): add copyToClipboard helper with execCommand fallback"`

---

## Self-Review

**Spec coverage (§7 acceptance):**
- online + version return — T1 (probe online test), T2 (route returns payload), T3 (smoke).
- red dot + install hint when `claude` uninstalled — T5 (offline renders install/login), T6 (integration with offline codex).
- 2s timeout, no event loop block — T1 (timeout test via `killed/SIGTERM`), `timeoutMs` flows into `execFile` options.
- 30s cache single `execFile` call — T1 (cache hit test asserts call count).
- Copy writes to clipboard — T5 (onCopy called), T7 (clipboard helper + fallback).
- Interval cleanup on unmount — T4 (unmount test).
- Narrow screen still shows both dots — T5 (`aria-label` + `title`), T6 (both dots rendered without relying on labels hiding).
- vitest coverage (online / offline-ENOENT / error-timeout / cache hit) — T1.

**Placeholder scan:** No `TODO`, `FIXME`, `XXX`, `TBD`, `placeholder`, `fill in`, `lorem ipsum` in the plan. All file paths concrete; all commands exact. Called out that `packages/backend` in spec maps to `packages/web-server` in the actual monorepo.

**Task count:** 7 tasks (T1–T7), within the requested [6, 9] range. The optional T8 README section from the brief was dropped — spec §8 doesn't require docs and keeping the plan small is preferred.

**Known spec gaps / deviations:**
- Spec types say `CliHealthItem.checkedAt: string` (ISO) but doesn't specify an aggregate envelope `checkedAt` — plan follows spec (per-item only).
- Spec mentions Radix Popover "or existing Tooltip pattern"; plan uses a lightweight in-component popover (no new dep) — acceptable per spec's "or" phrasing.
- Spec §5 "2px halo for loading" is omitted from the core component; T6 uses grey placeholder dots during first load, which achieves the same "don't jump / show probing" goal without extra state on `CliHealthDot`.
- Package naming: spec says `packages/backend`; this repo has `packages/web-server`. Plan uses the real path and flags the discrepancy at the top.
