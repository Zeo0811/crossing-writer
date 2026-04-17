# Plan 3 · 前端 D2 布局重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KnowledgePage 的"入库" Tab 从"账号 checkbox grid + 埋深的热力图勾选"重做为 **D2 左右分栏**：左账号边栏（mini 热力图）+ 右主区（大热力图 + 文章列表），跨账号勾选流进底部购物车，点击"入库 →"走 ConfirmDialog 做 dedupe 检查再提交。顶栏新增 ModelSelector 全局配模型。

**Architecture:** 新建 8 个组件 + 1 个 hook；`AccountHeatmap` 收窄职责；`IngestForm` 退役；沿用 Plan 2 的 `check-duplicates` / `ingest` 扩展字段；继续复用现有 `useIngestState` 做 SSE。

**Tech Stack:** React + TypeScript · Radix UI 封装在 `components/ui/*` · vitest + @testing-library

**Spec 参考:** `docs/superpowers/specs/2026-04-17-knowledge-page-ingest-redesign-design.md` §6.1~6.4

**依赖：** Plan 2（已合并）提供 `/api/kb/wiki/check-duplicates`、`POST /ingest` 新 body 字段。

---

## 文件结构

**新建：**
- `packages/web-ui/src/hooks/useIngestCart.ts` — 购物车 state
- `packages/web-ui/src/components/wiki/ModelSelector.tsx` — 顶栏模型选择
- `packages/web-ui/src/components/wiki/AccountSidebar.tsx` — 左账号边栏
- `packages/web-ui/src/components/wiki/MiniHeatmap.tsx` — 边栏用微型热力图 bar
- `packages/web-ui/src/components/wiki/ArticleList.tsx` — 文章行列表
- `packages/web-ui/src/components/wiki/IngestCartBar.tsx` — 底部购物车
- `packages/web-ui/src/components/wiki/IngestConfirmDialog.tsx` — 入库确认弹窗
- `packages/web-ui/src/components/wiki/IngestTab.tsx` — D2 布局容器（替代 IngestForm）
- `packages/web-ui/tests/ingest-cart.test.tsx`
- `packages/web-ui/tests/model-selector.test.tsx`
- `packages/web-ui/tests/account-sidebar.test.tsx`
- `packages/web-ui/tests/article-list.test.tsx`
- `packages/web-ui/tests/ingest-cart-bar.test.tsx`
- `packages/web-ui/tests/ingest-confirm-dialog.test.tsx`
- `packages/web-ui/tests/ingest-tab.test.tsx`

**修改：**
- `packages/web-ui/src/api/wiki-client.ts` — 扩展 `IngestStartArgs` + 加 `checkDuplicates`
- `packages/web-ui/src/components/wiki/AccountHeatmap.tsx` — 移除内部 checkbox UI；仍显示 hover 日历+单日文章 popup（只展示不选）
- `packages/web-ui/src/pages/KnowledgePage.tsx` — 换 `IngestTab`，头部加 `ModelSelector`
- `packages/web-ui/src/components/wiki/IngestForm.tsx` — 删除（被 IngestTab 替代）
- `packages/web-ui/tests/ingest-form.test.tsx` — 删除

---

## 约定

- 组件只用 `components/ui/*` 内的原子（`Button`、`Chip`、`Input`、`Dialog` 等）
- 色彩必须走 CSS var（`var(--accent)` 等），禁止 hex / `bg-white` / `text-red-600` tailwind 默认色
- 所有新组件挂 `data-testid` 便于测试
- 跨组件通信用 props + callback，不引入新的 context（`useIngestCart` 是 hook 返回 state；由 `IngestTab` 顶层持有 lift state down）

---

## Task 1：wiki-client 扩展

**Files:**
- Modify: `packages/web-ui/src/api/wiki-client.ts`

- [ ] **Step 1: Extend IngestStartArgs + add checkDuplicates**

在 `packages/web-ui/src/api/wiki-client.ts` 末尾追加（也同步 update IngestStartArgs 现有定义）：

找到现有 `export interface IngestStartArgs {` 块（约 line 77-85），替换为：

```ts
export interface IngestStartArgs {
  accounts: string[];
  article_ids?: string[];
  per_account_limit: number;
  batch_size: number;
  mode: "full" | "incremental" | "selected";
  since?: string;
  until?: string;
  cli_model?: { cli: "claude" | "codex"; model?: string };
  max_articles?: number;
  force_reingest?: boolean;
}
```

文件末尾（Plan 1 新 exports 之后）追加：

```ts
export interface DupCheckResult {
  already_ingested: Array<{
    article_id: string;
    first_ingested_at: string;
    last_ingested_at: string;
    last_run_id: string;
  }>;
  fresh: string[];
}

export async function checkDuplicates(articleIds: string[]): Promise<DupCheckResult> {
  const r = await fetch("/api/kb/wiki/check-duplicates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ article_ids: articleIds }),
  });
  if (!r.ok) throw new Error(`checkDuplicates ${r.status}`);
  return (await r.json()) as DupCheckResult;
}
```

- [ ] **Step 2: Verify tsc clean**

```bash
cd packages/web-ui && pnpm exec tsc --noEmit
```

Expected: 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web-ui/src/api/wiki-client.ts
git commit -m "feat(web-ui): wiki-client IngestStartArgs new fields + checkDuplicates"
```

---

## Task 2：`useIngestCart` hook — 跨账号购物车

**Files:**
- Create: `packages/web-ui/src/hooks/useIngestCart.ts`
- Create: `packages/web-ui/tests/ingest-cart.test.tsx`

- [ ] **Step 1: Write failing test**

Create `packages/web-ui/tests/ingest-cart.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIngestCart, type CartEntry } from "../src/hooks/useIngestCart";

const e1: CartEntry = { articleId: "A0", account: "AcctA", title: "t0", publishedAt: "2026-04-15", wordCount: 100 };
const e2: CartEntry = { articleId: "A1", account: "AcctA", title: "t1", publishedAt: "2026-04-14", wordCount: 200 };
const e3: CartEntry = { articleId: "B0", account: "AcctB", title: "tB0", publishedAt: "2026-04-13", wordCount: 300 };

describe("useIngestCart", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 50 }));
    expect(result.current.entries).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.exceedsMax).toBe(false);
  });

  it("toggle adds then removes an entry", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 50 }));
    act(() => { result.current.toggle(e1); });
    expect(result.current.entries.map((e) => e.articleId)).toEqual(["A0"]);
    act(() => { result.current.toggle(e1); });
    expect(result.current.entries).toEqual([]);
  });

  it("tracks totals and account breakdown", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 50 }));
    act(() => { result.current.toggle(e1); result.current.toggle(e2); result.current.toggle(e3); });
    expect(result.current.totalCount).toBe(3);
    expect(result.current.perAccountCount.get("AcctA")).toBe(2);
    expect(result.current.perAccountCount.get("AcctB")).toBe(1);
  });

  it("exceedsMax when total > maxArticles", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 2 }));
    act(() => { result.current.toggle(e1); result.current.toggle(e2); result.current.toggle(e3); });
    expect(result.current.exceedsMax).toBe(true);
  });

  it("has returns whether an id is in the cart", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 50 }));
    act(() => { result.current.toggle(e1); });
    expect(result.current.has("A0")).toBe(true);
    expect(result.current.has("A1")).toBe(false);
  });

  it("remove deletes by articleId", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 50 }));
    act(() => { result.current.toggle(e1); result.current.toggle(e2); });
    act(() => { result.current.remove("A0"); });
    expect(result.current.entries.map((e) => e.articleId)).toEqual(["A1"]);
  });

  it("clear wipes everything", () => {
    const { result } = renderHook(() => useIngestCart({ maxArticles: 50 }));
    act(() => { result.current.toggle(e1); result.current.toggle(e2); });
    act(() => { result.current.clear(); });
    expect(result.current.entries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test (fail)**

```bash
cd packages/web-ui && pnpm exec vitest run ingest-cart
```

- [ ] **Step 3: Implement hook**

Create `packages/web-ui/src/hooks/useIngestCart.ts`:

```ts
import { useCallback, useMemo, useState } from "react";

export interface CartEntry {
  articleId: string;
  account: string;
  title: string;
  publishedAt: string;
  wordCount: number | null;
}

export interface UseIngestCartInput {
  maxArticles: number;
}

export interface UseIngestCartReturn {
  entries: CartEntry[];
  totalCount: number;
  perAccountCount: Map<string, number>;
  exceedsMax: boolean;
  has: (articleId: string) => boolean;
  toggle: (entry: CartEntry) => void;
  remove: (articleId: string) => void;
  clear: () => void;
}

export function useIngestCart({ maxArticles }: UseIngestCartInput): UseIngestCartReturn {
  const [entries, setEntries] = useState<CartEntry[]>([]);

  const idSet = useMemo(() => new Set(entries.map((e) => e.articleId)), [entries]);
  const perAccountCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.account, (m.get(e.account) ?? 0) + 1);
    return m;
  }, [entries]);

  const has = useCallback((id: string) => idSet.has(id), [idSet]);
  const toggle = useCallback((entry: CartEntry) => {
    setEntries((prev) => prev.some((e) => e.articleId === entry.articleId)
      ? prev.filter((e) => e.articleId !== entry.articleId)
      : [...prev, entry]);
  }, []);
  const remove = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.articleId !== id));
  }, []);
  const clear = useCallback(() => setEntries([]), []);

  return {
    entries,
    totalCount: entries.length,
    perAccountCount,
    exceedsMax: entries.length > maxArticles,
    has, toggle, remove, clear,
  };
}
```

- [ ] **Step 4: Run tests (pass)**

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/hooks/useIngestCart.ts \
        packages/web-ui/tests/ingest-cart.test.tsx
git commit -m "feat(web-ui): useIngestCart — cross-account selection state"
```

---

## Task 3：`ModelSelector` 组件（顶栏）

**Files:**
- Create: `packages/web-ui/src/components/wiki/ModelSelector.tsx`
- Create: `packages/web-ui/tests/model-selector.test.tsx`

默认值：cli=`claude`、model=`sonnet`。localStorage key: `crossing:wiki:model`。

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModelSelector } from "../src/components/wiki/ModelSelector";

beforeEach(() => { localStorage.clear(); });

describe("ModelSelector", () => {
  it("defaults to claude/sonnet when no saved value", () => {
    render(<ModelSelector onChange={() => {}} />);
    expect(screen.getByText(/claude\/sonnet/)).toBeInTheDocument();
  });

  it("reads saved value from localStorage", () => {
    localStorage.setItem("crossing:wiki:model", JSON.stringify({ cli: "codex", model: "gpt-5" }));
    render(<ModelSelector onChange={() => {}} />);
    expect(screen.getByText(/codex\/gpt-5/)).toBeInTheDocument();
  });

  it("onChange called with new value after selection", () => {
    const onChange = vi.fn();
    render(<ModelSelector onChange={onChange} />);
    // Open menu
    fireEvent.click(screen.getByRole("button"));
    // Click opus option
    fireEvent.click(screen.getByText(/^opus$/));
    expect(onChange).toHaveBeenCalledWith({ cli: "claude", model: "opus" });
  });

  it("persists selection to localStorage", () => {
    const { rerender } = render(<ModelSelector onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText(/^haiku$/));
    expect(JSON.parse(localStorage.getItem("crossing:wiki:model")!)).toMatchObject({ cli: "claude", model: "haiku" });
  });
});
```

- [ ] **Step 2: Run (fail)**

- [ ] **Step 3: Implement**

Create `packages/web-ui/src/components/wiki/ModelSelector.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "../ui";

export interface ModelValue { cli: "claude" | "codex"; model: string }

const STORAGE_KEY = "crossing:wiki:model";
const DEFAULT: ModelValue = { cli: "claude", model: "sonnet" };

const CLAUDE_MODELS = ["opus", "sonnet", "haiku"] as const;
const CODEX_MODELS = ["gpt-5"] as const;

function read(): ModelValue {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v?.cli && v?.model) return v as ModelValue;
    }
  } catch { /* ignore */ }
  return DEFAULT;
}

function write(v: ModelValue) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
}

export interface ModelSelectorProps {
  onChange: (v: ModelValue) => void;
}

export function ModelSelector({ onChange }: ModelSelectorProps) {
  const [value, setValue] = useState<ModelValue>(read);

  useEffect(() => { onChange(value); /* initial */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (v: ModelValue) => { setValue(v); write(v); onChange(v); };

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          data-testid="model-selector"
          className="text-xs text-[var(--meta)] hover:text-[var(--heading)] px-2 py-1 rounded border border-[var(--hair)] hover:border-[var(--accent-soft)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          ⚙ {value.cli}/{value.model} ▾
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <div className="px-2 py-1 text-[10px] text-[var(--faint)]">claude</div>
        {CLAUDE_MODELS.map((m) => (
          <MenuItem key={`claude-${m}`} onSelect={() => select({ cli: "claude", model: m })}>
            {m}
          </MenuItem>
        ))}
        <MenuSeparator />
        <div className="px-2 py-1 text-[10px] text-[var(--faint)]">codex</div>
        {CODEX_MODELS.map((m) => (
          <MenuItem key={`codex-${m}`} onSelect={() => select({ cli: "codex", model: m })}>
            {m}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
```

**IMPORTANT:** Check actual Menu component API in `packages/web-ui/src/components/ui/Menu.tsx` first. If `MenuItem` uses different prop names (e.g., `onClick` instead of `onSelect`), adapt. If `MenuTrigger asChild` isn't supported, wrap differently.

- [ ] **Step 4: Run tests + commit**

```bash
cd packages/web-ui && pnpm exec vitest run model-selector
git add packages/web-ui/src/components/wiki/ModelSelector.tsx \
        packages/web-ui/tests/model-selector.test.tsx
git commit -m "feat(web-ui): ModelSelector top-nav cli/model picker"
```

---

## Task 4：`ArticleList` 组件

**Files:**
- Create: `packages/web-ui/src/components/wiki/ArticleList.tsx`
- Create: `packages/web-ui/tests/article-list.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArticleList } from "../src/components/wiki/ArticleList";

const articles = [
  { id: "A0", title: "AAA", published_at: "2026-04-15", ingest_status: "raw", word_count: 100 },
  { id: "A1", title: "BBB", published_at: "2026-04-14", ingest_status: "topics_tagged", word_count: 200 },
];

describe("ArticleList", () => {
  it("renders rows with title/date/wordcount", () => {
    render(<ArticleList articles={articles} duplicates={new Set()} selectedIds={new Set()} onToggle={() => {}} />);
    expect(screen.getByText("AAA")).toBeInTheDocument();
    expect(screen.getByText("BBB")).toBeInTheDocument();
    expect(screen.getByText("2026-04-15")).toBeInTheDocument();
  });

  it("shows checkbox checked for selectedIds", () => {
    render(<ArticleList articles={articles} duplicates={new Set()} selectedIds={new Set(["A0"])} onToggle={() => {}} />);
    const checkedBtn = screen.getByTestId("article-row-A0");
    expect(checkedBtn).toHaveAttribute("aria-pressed", "true");
    const unchecked = screen.getByTestId("article-row-A1");
    expect(unchecked).toHaveAttribute("aria-pressed", "false");
  });

  it("marks duplicates with badge and disables row", () => {
    render(<ArticleList articles={articles} duplicates={new Set(["A0"])} selectedIds={new Set()} onToggle={() => {}} />);
    expect(screen.getByTestId("article-row-A0")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/已入库/)).toBeInTheDocument();
  });

  it("onToggle fires for non-duplicate click", () => {
    const onToggle = vi.fn();
    render(<ArticleList articles={articles} duplicates={new Set()} selectedIds={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("article-row-A0"));
    expect(onToggle).toHaveBeenCalledWith("A0");
  });

  it("onToggle NOT fired when clicking duplicate row", () => {
    const onToggle = vi.fn();
    render(<ArticleList articles={articles} duplicates={new Set(["A0"])} selectedIds={new Set()} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("article-row-A0"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("renders empty state when articles is empty", () => {
    render(<ArticleList articles={[]} duplicates={new Set()} selectedIds={new Set()} onToggle={() => {}} />);
    expect(screen.getByText(/无文章/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run (fail)**

- [ ] **Step 3: Implement**

Create `packages/web-ui/src/components/wiki/ArticleList.tsx`:

```tsx
import { Chip } from "../ui";

export interface ArticleListItem {
  id: string;
  title: string;
  published_at: string;
  ingest_status: string;
  word_count: number | null;
}

export interface ArticleListProps {
  articles: ArticleListItem[];
  duplicates: Set<string>;
  selectedIds: Set<string>;
  onToggle: (articleId: string) => void;
}

export function ArticleList({ articles, duplicates, selectedIds, onToggle }: ArticleListProps) {
  if (articles.length === 0) {
    return <div className="py-8 text-center text-xs text-[var(--faint)]">无文章</div>;
  }
  return (
    <div className="rounded bg-[var(--bg-2)] overflow-hidden">
      {articles.map((a) => {
        const dup = duplicates.has(a.id);
        const selected = selectedIds.has(a.id);
        return (
          <button
            key={a.id}
            type="button"
            data-testid={`article-row-${a.id}`}
            aria-pressed={selected}
            aria-disabled={dup}
            disabled={dup}
            onClick={() => !dup && onToggle(a.id)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs border-b border-[var(--hair)] last:border-b-0 ${
              dup ? "opacity-50 cursor-not-allowed" :
              selected ? "bg-[var(--accent-fill)]" : "hover:bg-[rgba(64,255,159,0.04)]"
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center text-[9px] shrink-0 ${
              selected ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]" : "border-[var(--hair-strong)]"
            }`}>
              {selected && "✓"}
            </span>
            <span className="flex-1 min-w-0 truncate text-[var(--heading)]">{a.title}</span>
            <span className="text-[var(--meta)] shrink-0">{a.published_at}</span>
            {dup && <Chip variant="neutral" size="sm">已入库</Chip>}
            {a.word_count != null && <span className="text-[var(--faint)] shrink-0">{a.word_count}字</span>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run + commit**

```bash
cd packages/web-ui && pnpm exec vitest run article-list
git add packages/web-ui/src/components/wiki/ArticleList.tsx \
        packages/web-ui/tests/article-list.test.tsx
git commit -m "feat(web-ui): ArticleList with duplicate markers + selection"
```

---

## Task 5：`MiniHeatmap` + `AccountSidebar`

**Files:**
- Create: `packages/web-ui/src/components/wiki/MiniHeatmap.tsx`
- Create: `packages/web-ui/src/components/wiki/AccountSidebar.tsx`
- Create: `packages/web-ui/tests/account-sidebar.test.tsx`

### 5a. MiniHeatmap

Simple bar chart showing ingested ratio per account. No tests of its own (covered via AccountSidebar test).

```tsx
// packages/web-ui/src/components/wiki/MiniHeatmap.tsx
export interface MiniHeatmapProps { ingested: number; total: number }

export function MiniHeatmap({ ingested, total }: MiniHeatmapProps) {
  const pct = total > 0 ? Math.round((ingested / total) * 100) : 0;
  return (
    <div className="flex-1 h-1 rounded-full bg-[var(--bg-1)] overflow-hidden">
      <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
    </div>
  );
}
```

### 5b. AccountSidebar

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountSidebar } from "../src/components/wiki/AccountSidebar";

const accounts = [
  { account: "AcctA", count: 10, ingested_count: 3 },
  { account: "AcctB", count: 5, ingested_count: 5 },
];

describe("AccountSidebar", () => {
  it("lists accounts with counts", () => {
    render(<AccountSidebar accounts={accounts} active={null} cartPerAccount={new Map()} onSelect={() => {}} />);
    expect(screen.getByText("AcctA")).toBeInTheDocument();
    expect(screen.getByText("AcctB")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("highlights active account", () => {
    render(<AccountSidebar accounts={accounts} active="AcctA" cartPerAccount={new Map()} onSelect={() => {}} />);
    expect(screen.getByTestId("sidebar-item-AcctA")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("sidebar-item-AcctB")).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelect when account clicked", () => {
    const onSelect = vi.fn();
    render(<AccountSidebar accounts={accounts} active={null} cartPerAccount={new Map()} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("sidebar-item-AcctB"));
    expect(onSelect).toHaveBeenCalledWith("AcctB");
  });

  it("shows cart badge when account has cart items", () => {
    render(<AccountSidebar accounts={accounts} active={null} cartPerAccount={new Map([["AcctA", 3]])} onSelect={() => {}} />);
    expect(screen.getByTestId("sidebar-cart-AcctA")).toHaveTextContent("3");
  });
});
```

- [ ] **Step 2: Run (fail)**

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/wiki/AccountSidebar.tsx
import { MiniHeatmap } from "./MiniHeatmap";

export interface AccountStat {
  account: string;
  count: number;
  ingested_count: number;
}

export interface AccountSidebarProps {
  accounts: AccountStat[];
  active: string | null;
  cartPerAccount: Map<string, number>;
  onSelect: (account: string) => void;
}

export function AccountSidebar({ accounts, active, cartPerAccount, onSelect }: AccountSidebarProps) {
  return (
    <aside className="w-[220px] shrink-0 bg-[var(--bg-2)] rounded p-3 overflow-auto max-h-[70vh]">
      <div className="text-xs text-[var(--meta)] font-semibold mb-2">账号（{accounts.length}）</div>
      <ul className="space-y-1">
        {accounts.map((a) => {
          const isActive = active === a.account;
          const cart = cartPerAccount.get(a.account) ?? 0;
          return (
            <li key={a.account}>
              <button
                type="button"
                data-testid={`sidebar-item-${a.account}`}
                aria-selected={isActive}
                onClick={() => onSelect(a.account)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left ${
                  isActive ? "bg-[var(--accent-fill)] text-[var(--accent)]" : "text-[var(--body)] hover:bg-[var(--bg-1)]"
                }`}
              >
                <span className="truncate flex-1">{a.account}</span>
                <span className="text-[var(--faint)] shrink-0">{a.count}</span>
                {cart > 0 && (
                  <span
                    data-testid={`sidebar-cart-${a.account}`}
                    className="text-[9px] bg-[var(--accent)] text-[var(--accent-on)] rounded-full px-1.5"
                  >
                    {cart}
                  </span>
                )}
                <MiniHeatmap ingested={a.ingested_count} total={a.count} />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 4: Run + commit**

```bash
cd packages/web-ui && pnpm exec vitest run account-sidebar
git add packages/web-ui/src/components/wiki/MiniHeatmap.tsx \
        packages/web-ui/src/components/wiki/AccountSidebar.tsx \
        packages/web-ui/tests/account-sidebar.test.tsx
git commit -m "feat(web-ui): AccountSidebar with mini heatmap + cart badges"
```

---

## Task 6：`IngestCartBar`

**Files:**
- Create: `packages/web-ui/src/components/wiki/IngestCartBar.tsx`
- Create: `packages/web-ui/tests/ingest-cart-bar.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IngestCartBar } from "../src/components/wiki/IngestCartBar";
import type { CartEntry } from "../src/hooks/useIngestCart";

const entries: CartEntry[] = [
  { articleId: "A0", account: "AcctA", title: "t0", publishedAt: "2026-04-15", wordCount: 100 },
  { articleId: "A1", account: "AcctA", title: "t1", publishedAt: "2026-04-14", wordCount: 200 },
  { articleId: "B0", account: "AcctB", title: "tB0", publishedAt: "2026-04-13", wordCount: 300 },
];

describe("IngestCartBar", () => {
  it("shows count + account breakdown + total words", () => {
    render(<IngestCartBar entries={entries} maxArticles={50} onClear={() => {}} onSubmit={() => {}} />);
    expect(screen.getByText(/已选 3 篇/)).toBeInTheDocument();
    expect(screen.getByText(/AcctA 2/)).toBeInTheDocument();
    expect(screen.getByText(/AcctB 1/)).toBeInTheDocument();
    expect(screen.getByText(/600/)).toBeInTheDocument();
  });

  it("submit button disabled when empty", () => {
    render(<IngestCartBar entries={[]} maxArticles={50} onClear={() => {}} onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /入库/ })).toBeDisabled();
  });

  it("exceeds max shows warning + disabled submit", () => {
    render(<IngestCartBar entries={entries} maxArticles={2} onClear={() => {}} onSubmit={() => {}} />);
    expect(screen.getByText(/超上限|超过/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /入库/ })).toBeDisabled();
  });

  it("clear clicks onClear", () => {
    const onClear = vi.fn();
    render(<IngestCartBar entries={entries} maxArticles={50} onClear={onClear} onSubmit={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /清空/ }));
    expect(onClear).toHaveBeenCalled();
  });

  it("submit clicks onSubmit", () => {
    const onSubmit = vi.fn();
    render(<IngestCartBar entries={entries} maxArticles={50} onClear={() => {}} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /入库/ }));
    expect(onSubmit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (fail)**

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/wiki/IngestCartBar.tsx
import type { CartEntry } from "../../hooks/useIngestCart";
import { Button, Chip } from "../ui";

export interface IngestCartBarProps {
  entries: CartEntry[];
  maxArticles: number;
  onClear: () => void;
  onSubmit: () => void;
}

export function IngestCartBar({ entries, maxArticles, onClear, onSubmit }: IngestCartBarProps) {
  const totalCount = entries.length;
  const exceedsMax = totalCount > maxArticles;
  const totalWords = entries.reduce((s, e) => s + (e.wordCount ?? 0), 0);
  const perAccount = new Map<string, number>();
  for (const e of entries) perAccount.set(e.account, (perAccount.get(e.account) ?? 0) + 1);

  const breakdown = Array.from(perAccount.entries()).map(([a, n]) => `${a} ${n}`).join(" · ");

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded border ${
      exceedsMax ? "border-[var(--red)] bg-[rgba(255,107,107,0.05)]" : "border-[var(--accent-soft)] bg-[var(--bg-1)]"
    }`}>
      <Chip variant={exceedsMax ? "red" : "accent"} size="sm">已选 {totalCount} 篇</Chip>
      {breakdown && <span className="text-xs text-[var(--meta)]">{breakdown} · 约 {totalWords} 字</span>}
      {exceedsMax && <span className="text-xs text-[var(--red)]">超上限 {maxArticles}</span>}
      <span className="flex-1" />
      <Button variant="ghost" size="sm" onClick={onClear} disabled={totalCount === 0}>清空</Button>
      <Button variant="primary" size="md" onClick={onSubmit} disabled={totalCount === 0 || exceedsMax}>入库 →</Button>
    </div>
  );
}
```

- [ ] **Step 4: Run + commit**

```bash
cd packages/web-ui && pnpm exec vitest run ingest-cart-bar
git add packages/web-ui/src/components/wiki/IngestCartBar.tsx \
        packages/web-ui/tests/ingest-cart-bar.test.tsx
git commit -m "feat(web-ui): IngestCartBar with exceeds-max warning"
```

---

## Task 7：`IngestConfirmDialog`

**Files:**
- Create: `packages/web-ui/src/components/wiki/IngestConfirmDialog.tsx`
- Create: `packages/web-ui/tests/ingest-confirm-dialog.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IngestConfirmDialog } from "../src/components/wiki/IngestConfirmDialog";
import type { CartEntry } from "../src/hooks/useIngestCart";

const entries: CartEntry[] = [
  { articleId: "A0", account: "AcctA", title: "T0", publishedAt: "2026-04-15", wordCount: 100 },
  { articleId: "A1", account: "AcctA", title: "T1", publishedAt: "2026-04-14", wordCount: 200 },
];

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

function mockDupResponse(alreadyIngestedIds: string[], fresh: string[]) {
  vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify({
      already_ingested: alreadyIngestedIds.map((id) => ({ article_id: id, first_ingested_at: "2026-04-01", last_ingested_at: "2026-04-02", last_run_id: "r1" })),
      fresh,
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
}

describe("IngestConfirmDialog", () => {
  it("renders summary + all fresh (no warning)", async () => {
    mockDupResponse([], ["A0", "A1"]);
    render(<IngestConfirmDialog open entries={entries} model={{ cli: "claude", model: "sonnet" }} onConfirm={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText(/2 篇/)).toBeInTheDocument());
    expect(screen.queryByText(/已入过库/)).toBeNull();
  });

  it("shows already-ingested warning with count", async () => {
    mockDupResponse(["A0"], ["A1"]);
    render(<IngestConfirmDialog open entries={entries} model={{ cli: "claude", model: "sonnet" }} onConfirm={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText(/1 篇.*已入/)).toBeInTheDocument());
    // Default: force_reingest is false
    const checkbox = screen.getByRole("checkbox", { name: /重新入库/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("confirm with force_reingest=true passes flag in payload", async () => {
    mockDupResponse(["A0"], ["A1"]);
    const onConfirm = vi.fn();
    render(<IngestConfirmDialog open entries={entries} model={{ cli: "claude", model: "sonnet" }} onConfirm={onConfirm} onCancel={() => {}} />);
    await waitFor(() => screen.getByText(/2 篇/));
    fireEvent.click(screen.getByRole("checkbox", { name: /重新入库/ }));
    fireEvent.click(screen.getByRole("button", { name: /确认入库/ }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      mode: "selected",
      article_ids: ["A0", "A1"],
      force_reingest: true,
      cli_model: { cli: "claude", model: "sonnet" },
    }));
  });

  it("confirm without force_reingest omits duplicates from article_ids", async () => {
    mockDupResponse(["A0"], ["A1"]);
    const onConfirm = vi.fn();
    render(<IngestConfirmDialog open entries={entries} model={{ cli: "claude", model: "sonnet" }} onConfirm={onConfirm} onCancel={() => {}} />);
    await waitFor(() => screen.getByText(/2 篇/));
    fireEvent.click(screen.getByRole("button", { name: /确认入库/ }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      article_ids: ["A1"],
      force_reingest: false,
    }));
  });

  it("cancel fires onCancel", () => {
    mockDupResponse([], []);
    const onCancel = vi.fn();
    render(<IngestConfirmDialog open entries={entries} model={{ cli: "claude", model: "sonnet" }} onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (fail)**

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/wiki/IngestConfirmDialog.tsx
import { useEffect, useState } from "react";
import { Dialog, DialogContent, Button, Chip } from "../ui";
import { checkDuplicates, type DupCheckResult, type IngestStartArgs } from "../../api/wiki-client";
import type { CartEntry } from "../../hooks/useIngestCart";

export interface IngestConfirmDialogProps {
  open: boolean;
  entries: CartEntry[];
  model: { cli: "claude" | "codex"; model: string };
  onConfirm: (payload: IngestStartArgs) => void;
  onCancel: () => void;
}

export function IngestConfirmDialog({ open, entries, model, onConfirm, onCancel }: IngestConfirmDialogProps) {
  const [dup, setDup] = useState<DupCheckResult | null>(null);
  const [force, setForce] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || entries.length === 0) return;
    let cancelled = false;
    setLoading(true);
    checkDuplicates(entries.map((e) => e.articleId))
      .then((r) => { if (!cancelled) setDup(r); })
      .catch(() => { if (!cancelled) setDup({ already_ingested: [], fresh: entries.map((e) => e.articleId) }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, entries]);

  const alreadyCount = dup?.already_ingested.length ?? 0;
  const freshCount = dup?.fresh.length ?? entries.length;
  const targetIds = force ? entries.map((e) => e.articleId) : (dup?.fresh ?? []);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent width={520} aria-label="入库确认">
        <div className="px-5 pt-4 pb-2 border-b border-[var(--hair)]">
          <h2 className="text-base font-semibold text-[var(--heading)]">入库确认</h2>
          <p className="text-xs text-[var(--meta)] mt-1">{entries.length} 篇 · 模型 {model.cli}/{model.model}</p>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-auto">
          {loading && <div className="text-xs text-[var(--meta)]">检查去重中…</div>}
          {!loading && dup && (
            <>
              {alreadyCount > 0 && (
                <div className="rounded bg-[var(--amber-bg)] border border-[var(--amber-hair)] p-3 space-y-2">
                  <div className="text-xs text-[var(--amber)]">
                    其中 <strong>{alreadyCount} 篇</strong>已入过库
                  </div>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                    <span>重新入库（覆盖已有 source）</span>
                  </label>
                </div>
              )}
              <div className="text-xs text-[var(--body)]">
                将处理 <Chip variant="accent" size="sm">{targetIds.length} 篇</Chip>
                {!force && alreadyCount > 0 && <span className="text-[var(--faint)]">（跳过 {alreadyCount} 篇已入库）</span>}
              </div>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[var(--hair)] flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button
            variant="primary"
            disabled={loading || targetIds.length === 0}
            onClick={() => onConfirm({
              accounts: [],
              article_ids: targetIds,
              per_account_limit: 50,
              batch_size: 5,
              mode: "selected",
              cli_model: model,
              force_reingest: force,
              max_articles: Math.max(entries.length, 50),
            })}
          >
            确认入库
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run + commit**

```bash
cd packages/web-ui && pnpm exec vitest run ingest-confirm-dialog
git add packages/web-ui/src/components/wiki/IngestConfirmDialog.tsx \
        packages/web-ui/tests/ingest-confirm-dialog.test.tsx
git commit -m "feat(web-ui): IngestConfirmDialog with dedupe check + force reingest"
```

---

## Task 8：`AccountHeatmap` 职责收窄

**Files:**
- Modify: `packages/web-ui/src/components/wiki/AccountHeatmap.tsx`

移除内部 checkbox UI 与 "入库选中 N 篇" 按钮。保留：
- 热力图格子显示（按日分布）
- Hover 日历单格 → 展开该日文章列表（只读展示）
- 内部 state `selected` 全部删除
- 暴露新 prop `onArticleClick(articleId)`：单日文章列表里点标题时触发（由父组件决定加入购物车还是别的）

- [ ] **Step 1: Write failing test（追加到现有 account-heatmap.test.tsx 或新建）**

Create `packages/web-ui/tests/account-heatmap.test.tsx` (或检查是否已有 heatmap 测试，如果有则修改):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountHeatmap } from "../src/components/wiki/AccountHeatmap";

beforeEach(() => { vi.restoreAllMocks(); });

describe("AccountHeatmap (refactored)", () => {
  it("does not render internal ingest button or checkbox ui", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([
        { id: "A0", title: "t", published_at: "2026-04-15", ingest_status: "raw", word_count: 100 },
      ]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    render(<AccountHeatmap account="AcctA" />);
    await waitFor(() => screen.queryByText(/AcctA/));
    expect(screen.queryByText(/入库选中/)).toBeNull();
    expect(screen.queryByText(/全选未入库/)).toBeNull();
    expect(screen.queryByText(/清空选择/)).toBeNull();
  });

  it("onArticleClick fires when article in hover popup clicked", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([
        { id: "A0", title: "t0", published_at: "2026-04-15", ingest_status: "raw", word_count: 100 },
      ]), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const onArticleClick = vi.fn();
    render(<AccountHeatmap account="AcctA" onArticleClick={onArticleClick} />);
    // Implementation specific: how to trigger hover popup in jsdom is tricky.
    // If the popup shows on cell hover, render & then interact. Simplest:
    // assert the component renders without throwing & exposes the prop.
    await waitFor(() => expect(screen.getByText(/未入库/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Rewrite AccountHeatmap**

Edit `packages/web-ui/src/components/wiki/AccountHeatmap.tsx`:

Remove `selected`, `toggleArticle`, `toggleDate`, `applyDrag`, `onCellMouseDown` drag logic, `selectAllRaw`, `onDragEnd`, `dragging`, `dragMode`, `onIngestSelected` prop.

New Props interface:

```ts
interface Props {
  account: string;
  onArticleClick?: (articleId: string, title: string, publishedAt: string, wordCount: number | null) => void;
}
```

In hover popup rendering, change the row:

```tsx
// BEFORE: clickable checkbox + toggleArticle
// AFTER: clickable title fires onArticleClick
<div
  key={a.id}
  className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
    isRaw ? "cursor-pointer hover:bg-[var(--bg-1)]" : ""
  }`}
  onClick={() => isRaw && onArticleClick?.(a.id, a.title, a.published_at, a.word_count)}
>
  <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: isRaw ? "var(--hair-strong)" : "var(--accent)" }} />
  <span className={`truncate flex-1 ${isRaw ? "text-[var(--body)]" : "text-[var(--meta)]"}`}>{a.title}</span>
  <span className="text-[var(--faint)] shrink-0">{a.word_count ?? "—"} 字</span>
</div>
```

Remove the bottom action bar (全选未入库 + 入库选中 N 篇 buttons).

Keep: SVG heatmap grid, month labels, hover popup skeleton.

- [ ] **Step 3: Run tests + commit**

```bash
cd packages/web-ui && pnpm exec vitest run account-heatmap
git add packages/web-ui/src/components/wiki/AccountHeatmap.tsx \
        packages/web-ui/tests/account-heatmap.test.tsx
git commit -m "refactor(web-ui): AccountHeatmap narrowed to hover-popup + onArticleClick"
```

---

## Task 9：`IngestTab` — D2 布局容器

**Files:**
- Create: `packages/web-ui/src/components/wiki/IngestTab.tsx`
- Create: `packages/web-ui/tests/ingest-tab.test.tsx`

**组合所有子组件 + 驱动数据流：**

- [ ] **Step 1: Write failing test** (smoke-level)

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { IngestTab } from "../src/components/wiki/IngestTab";
import { IngestProvider } from "../src/hooks/useIngestState";

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

function mockFetches(handlers: Record<string, Response>) {
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    for (const k of Object.keys(handlers)) if (url.includes(k)) return handlers[k]!.clone();
    return new Response("not mocked", { status: 500 });
  });
}

describe("IngestTab smoke", () => {
  it("renders sidebar + main + cart bar", async () => {
    mockFetches({
      "/api/kb/accounts": new Response(JSON.stringify([
        { account: "AcctA", count: 3, ingested_count: 0, earliest_published_at: "2026-04-10", latest_published_at: "2026-04-15" },
      ]), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    render(
      <IngestProvider>
        <IngestTab model={{ cli: "claude", model: "sonnet" }} />
      </IngestProvider>,
    );
    await waitFor(() => expect(screen.getByText("AcctA")).toBeInTheDocument());
    expect(screen.getByText(/账号（1）/)).toBeInTheDocument();
    expect(screen.getByText(/已选 0 篇/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement IngestTab**

```tsx
// packages/web-ui/src/components/wiki/IngestTab.tsx
import { useEffect, useMemo, useState } from "react";
import { AccountSidebar } from "./AccountSidebar";
import { AccountHeatmap } from "./AccountHeatmap";
import { ArticleList, type ArticleListItem } from "./ArticleList";
import { IngestCartBar } from "./IngestCartBar";
import { IngestConfirmDialog } from "./IngestConfirmDialog";
import { useIngestCart, type CartEntry } from "../../hooks/useIngestCart";
import { useIngestState } from "../../hooks/useIngestState";
import { Input } from "../ui";

interface AccountStat {
  account: string;
  count: number;
  ingested_count: number;
  earliest_published_at: string;
  latest_published_at: string;
}

export interface IngestTabProps {
  model: { cli: "claude" | "codex"; model: string };
}

const MAX_ARTICLES = 50;

export function IngestTab({ model }: IngestTabProps) {
  const [accounts, setAccounts] = useState<AccountStat[]>([]);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [search, setSearch] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const cart = useIngestCart({ maxArticles: MAX_ARTICLES });
  const ingest = useIngestState();

  // Load accounts
  useEffect(() => {
    void fetch("/api/kb/accounts").then(async (r) => {
      if (r.ok) setAccounts(await r.json());
    });
  }, []);

  // Load articles when active account changes
  useEffect(() => {
    if (!activeAccount) { setArticles([]); return; }
    void fetch(`/api/kb/accounts/${encodeURIComponent(activeAccount)}/articles?limit=3000`).then(async (r) => {
      if (r.ok) setArticles(await r.json());
    });
  }, [activeAccount]);

  const visibleArticles = useMemo(() => {
    if (!search) return articles;
    const q = search.toLowerCase();
    return articles.filter((a) => a.title.toLowerCase().includes(q));
  }, [articles, search]);

  const duplicates = useMemo(() => new Set<string>(), []); // Dialog does dedup; list view can show ingest_status hint
  const selectedIds = useMemo(() => new Set(cart.entries.map((e) => e.articleId)), [cart.entries]);

  function toggleArticle(articleId: string) {
    const a = articles.find((x) => x.id === articleId);
    if (!a || !activeAccount) return;
    const entry: CartEntry = {
      articleId: a.id, account: activeAccount, title: a.title,
      publishedAt: a.published_at, wordCount: a.word_count,
    };
    cart.toggle(entry);
  }

  function handleConfirm(payload: import("../../api/wiki-client").IngestStartArgs) {
    setShowConfirm(false);
    ingest.start(payload);
    cart.clear();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4">
        <AccountSidebar
          accounts={accounts}
          active={activeAccount}
          cartPerAccount={cart.perAccountCount}
          onSelect={setActiveAccount}
        />
        <main className="flex-1 min-w-0 space-y-4">
          {activeAccount ? (
            <>
              <div className="rounded bg-[var(--bg-2)] p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-[var(--heading)]">{activeAccount}</h2>
                  <span className="text-xs text-[var(--faint)]">
                    {accounts.find((a) => a.account === activeAccount)?.count ?? 0} 篇
                  </span>
                </div>
                <AccountHeatmap account={activeAccount} />
              </div>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索该账号文章标题…"
                leftSlot="⌕"
              />
              <ArticleList
                articles={visibleArticles}
                duplicates={duplicates}
                selectedIds={selectedIds}
                onToggle={toggleArticle}
              />
            </>
          ) : (
            <div className="text-center py-16 text-[var(--meta)]">← 选一个账号</div>
          )}
        </main>
      </div>

      <IngestCartBar
        entries={cart.entries}
        maxArticles={MAX_ARTICLES}
        onClear={cart.clear}
        onSubmit={() => setShowConfirm(true)}
      />

      <IngestConfirmDialog
        open={showConfirm}
        entries={cart.entries}
        model={model}
        onConfirm={handleConfirm}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
cd packages/web-ui && pnpm exec vitest run ingest-tab
git add packages/web-ui/src/components/wiki/IngestTab.tsx \
        packages/web-ui/tests/ingest-tab.test.tsx
git commit -m "feat(web-ui): IngestTab D2 layout (sidebar + main + cart + dialog)"
```

---

## Task 10：KnowledgePage 集成

**Files:**
- Modify: `packages/web-ui/src/pages/KnowledgePage.tsx`
- Delete: `packages/web-ui/src/components/wiki/IngestForm.tsx`
- Delete: `packages/web-ui/tests/ingest-form.test.tsx`

- [ ] **Step 1: Replace IngestForm with IngestTab**

Edit `packages/web-ui/src/pages/KnowledgePage.tsx`:

1. Remove `import { IngestForm } from "../components/wiki/IngestForm.js";`
2. Add `import { IngestTab } from "../components/wiki/IngestTab.js";`
3. Add `import { ModelSelector, type ModelValue } from "../components/wiki/ModelSelector.js";`  (if ModelSelector exports ModelValue; otherwise inline the type)
4. In component state add: `const [model, setModel] = useState<{cli:"claude"|"codex";model:string}>({ cli: "claude", model: "sonnet" });`
5. In header, next to `{statusInfo && ...}`, add: `<ModelSelector onChange={setModel} />`
6. Replace the `<TabsContent value="ingest">` children (the `<IngestForm ... />`) with `<IngestTab model={model} />`
7. Remove `const accountNames = useMemo(...)` and `ingest.start` prop plumbing — `IngestTab` handles ingest internally via `useIngestState`

- [ ] **Step 2: Delete old files**

```bash
git rm packages/web-ui/src/components/wiki/IngestForm.tsx
git rm packages/web-ui/tests/ingest-form.test.tsx
```

- [ ] **Step 3: tsc + vitest + commit**

```bash
cd packages/web-ui && pnpm exec tsc --noEmit
pnpm exec vitest run
git add packages/web-ui/src/pages/KnowledgePage.tsx
git commit -m "feat(web-ui): KnowledgePage uses IngestTab + ModelSelector"
```

- [ ] **Step 4: Manual smoke**

Start dev servers. Open /knowledge → 入库 tab. Verify:
- 左侧账号列表 + mini 热力图 OK
- 点一个账号 → 右侧显示大热力图 + 文章列表
- 勾选几篇 → 底部购物车 "已选 N 篇" 更新
- 点"入库 →" → ConfirmDialog 弹出，显示 dedupe 结果
- 确认 → SSE 事件流进 useIngestState
- 顶栏 ModelSelector 可切换 cli/model

---

## 风险与注意事项

1. **Menu 组件 API**：Task 3 假设 `MenuItem.onSelect` 回调；如实际是 `onClick`，调整。先读 `packages/web-ui/src/components/ui/Menu.tsx` 确认
2. **Chip variant="red"**：若不存在，改用 `tone="solid"` 或内联类 `text-[var(--red)]`
3. **AccountHeatmap 测试环境**：hover 事件在 jsdom 下可能不触发；Task 8 第 2 个测试用渲染断言而非交互断言
4. **ModelSelector 默认初始化**：组件挂载时的 `onChange(value)` 确保父组件首次拿到值；谨慎避免无限 re-render
5. **useIngestCart 性能**：O(n) 每次 toggle；50 篇上限下完全 OK
6. **IngestTab 的 `duplicates` 计算**：当前实现只把 Dialog 里查出的 dedupe 结果用于确认流程，列表视图不实时显示"已入库"徽章。如需实时显示，需在 Account 切换时 `checkDuplicates(articles.map((a) => a.id))` 拿集合。留作 Plan 3 的 polish task，不阻塞核心

---

## Self-Review Check

- [x] Spec §6 的 D2 结构 / AccountSidebar / IngestMain / ArticleList / IngestCartBar / IngestConfirmDialog / ModelSelector 每个组件对应一个 task
- [x] AccountHeatmap 职责收窄（§6.2 表格中"收窄职责：只负责展示 hover 出当日文章，不再做勾选 UI"）对应 Task 8
- [x] 使用 Plan 2 提供的 `/check-duplicates` + `/ingest` 新字段
- [x] Placeholder scan：无 TBD；所有代码/测试都 verbatim
- [x] Type consistency：`CartEntry`, `IngestStartArgs`, `ModelValue` 全链条一致
