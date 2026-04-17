# 知识库页 · 入库交互重做 + MD 跳转修复 — Design Spec

- **Spec ID**: 2026-04-17-knowledge-page-ingest-redesign
- **Date**: 2026-04-17
- **Status**: Draft（待用户 review）
- **Predecessors**: sp07-wiki-ingestor（已上线）· v1.6 UI 库
- **Successors**: 待定

---

## 1. 动机

`/knowledge` 页上线后积累了三类实际使用痛点：

1. **MD 页跳转点不了** — `WikiPagePreview` 只剥掉 frontmatter 后裸跑 `ReactMarkdown`，frontmatter 里的 `backlinks` / `sources` / `images` 没渲染；正文里 wiki 实体名不 auto-link；source 的 `article_id` 也没入口跳到 `10_refs/` 原文
2. **入库粒度太粗 + 选择体验断头路** — `IngestForm` 只能按账号整体入库；`AccountHeatmap` 虽然支持单篇勾选，但 `onIngestSelected` 回调从来没被 `IngestForm` 接起来，选了也不会进 submit payload；后端 `/api/kb/wiki/ingest` 也只接受 `accounts`，不接受 `article_ids`
3. **入库结果看不见** — 只有一条 SSE 日志流滚，run 完毕只给 `pages_created=X` 汇总；没法看今天新增了哪几页、哪些走了 append_source、哪些 conflict，也没有历史可查

本 spec 一次性收敛这三类问题。

## 2. 锁定决策

| 维度 | 选择 |
|---|---|
| 布局方向 | **D2 · 左右分栏** — 左账号边栏（mini 热力图）+ 右主区（大热力图 + 文章列表） |
| 跨账号选择 | 底部常驻购物车收集 `{articleId, account}[]` |
| 模型选择器位置 | **KnowledgePage 右上角顶栏**常驻按钮（非折叠） |
| 默认模型 | `claude/sonnet`（从 `opus` 降级，订阅配额紧张） |
| 单次篇数上限 | **默认 50**，超过 block |
| "已入库"判定 | 新增 `wiki_ingest_marks` 表，**只从本 feature 上线起打点**；旧数据不回填，视为"未入库" |
| MD 跳转 | 三种同时做：实体名 auto-link + frontmatter footer 渲染 + source 抽屉 |
| 入库过程可视化 | **复用** `ProjectWorkbench` 的 `ConsoleFab` + `ProjectActivityView` 样式骨架，新建 `IngestConsoleFab` + `IngestActivityView` |
| 结果展示 | 入库完成弹 `IngestResultDialog` + 新增"活动"Tab + 浏览视图 24h NEW 徽章 |

## 3. 明确不做（out of scope）

- 规则 UI 编辑 / 账号级补充规则 / 规则版本快照 / Dry-run 预览
- 成本预估 / 按账号或长度的模型路由 / 失败自动升级模型
- 旧数据回填 `wiki_ingest_marks`（用户明确要求从新规则起点）
- 入库中断后的自动续跑（取消即中止，保留已 apply 的）
- Auto-link 的 Aho-Corasick 等高性能实现（现规模 168 页不需要）

## 4. 架构总览

```
┌ KnowledgePage ─────────────────────────────────────────────────┐
│  Header: [h1 知识库]              [ModelSelector claude/sonnet ▾]│
│  Tabs: [浏览] [入库] [活动]                                       │
│  ┌─ 浏览 Tab ──────────────────────────────────────────────┐    │
│  │  kinds filter + search   + "只看最近 24h 变动" chip      │    │
│  │  page cards grid（24h 内变动者加 NEW 徽章）              │    │
│  │  selected: WikiPagePreview（带 frontmatter footer）       │    │
│  │    └─ source 点击 → Dialog 抽屉打开 10_refs 原文          │    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌─ 入库 Tab（D2 布局）────────────────────────────────────┐    │
│  │  AccountSidebar(220px) │ IngestMain(rest)               │    │
│  │    账号 + 计数 + mini   │  AccountHeader                 │    │
│  │    热力图条            │  AccountHeatmap（收窄职责）    │    │
│  │                        │  ArticleFilter                  │    │
│  │                        │  ArticleList（勾选+已入库标记） │    │
│  │  ─────────────────────────────────────────────────       │    │
│  │  IngestCartBar（跨账号，常驻底部）                        │    │
│  │    已选 7 篇 · 跨 3 账号 · [清空] [入库 →]                │    │
│  │                                    └ IngestConfirmDialog  │    │
│  └──────────────────────────────────────────────────────────┘    │
│  ┌─ 活动 Tab ───────────────────────────────────────────────┐    │
│  │  筛选: 账号 · 日期 · 状态                                  │    │
│  │  Run 卡片倒序 → 点 "查看详情" → IngestResultDialog        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  [IngestConsoleFab] ← 右下圆形按钮（入库 Tab 且有 run 时可见）    │
│   └─ 全屏 IngestActivityView（SSE ops 流）                         │
└───────────────────────────────────────────────────────────────────┘
```

## 5. 后端改动

### 5.1 数据模型（新增三表，sqlite 同库 `refs.sqlite`）

```sql
CREATE TABLE IF NOT EXISTS wiki_ingest_marks (
  article_id         TEXT PRIMARY KEY,
  first_ingested_at  TEXT NOT NULL,       -- ISO8601
  last_ingested_at   TEXT NOT NULL,
  ingest_count       INTEGER NOT NULL DEFAULT 1,
  last_run_id        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wiki_ingest_runs (
  id                 TEXT PRIMARY KEY,    -- uuid v4
  started_at         TEXT NOT NULL,
  finished_at        TEXT,
  status             TEXT NOT NULL,       -- running | done | error | cancelled
  accounts           TEXT NOT NULL,       -- JSON array of account names
  article_ids        TEXT NOT NULL,       -- JSON array of article ids
  mode               TEXT NOT NULL,       -- full | incremental | selected
  model              TEXT NOT NULL,       -- e.g. "claude/sonnet"
  pages_created      INTEGER DEFAULT 0,
  pages_updated      INTEGER DEFAULT 0,
  sources_appended   INTEGER DEFAULT 0,
  images_appended    INTEGER DEFAULT 0,
  conflict_count     INTEGER DEFAULT 0,
  skipped_count      INTEGER DEFAULT 0,   -- 已入库且未强制重入
  error              TEXT
);

CREATE TABLE IF NOT EXISTS wiki_ingest_run_ops (
  run_id       TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  op           TEXT NOT NULL,             -- upsert | append_source | append_image | add_backlink | note | error
  path         TEXT,                      -- wiki page path（error 时可为 null）
  article_id   TEXT,                      -- 触发此 op 的源文章
  created_page INTEGER DEFAULT 0,         -- upsert 时是否真的新建
  conflict     INTEGER DEFAULT 0,         -- 是否判为 conflict
  error        TEXT,                      -- 单 op 失败原因
  PRIMARY KEY (run_id, seq)
);
```

**只从本 feature 上线起写**，旧 run 不回填。查询"已入库"即 `SELECT 1 FROM wiki_ingest_marks WHERE article_id IN (...)`。

### 5.2 `@crossing/kb` · `runIngest` 扩展

```ts
interface IngestOptions {
  accounts?: string[];             // 既有
  articleIds?: string[];           // 新增
  perAccountLimit: number;
  batchSize: number;
  mode: "full" | "incremental" | "selected";  // 新增 selected 值
  since?: string;
  until?: string;
  cliModel?: { cli: "claude" | "codex"; model?: string };
  maxArticles?: number;            // 新增，默认 50
  forceReingest?: boolean;         // 新增，默认 false
  onEvent?: (ev: IngestStepEvent) => void;
}
```

行为变更：

- `mode="selected"` 且传 `articleIds`：按 id 直查 `ref_articles`，忽略 `accounts` 的 `perAccountLimit`
- `articleIds` 非空 ↔ `mode` 必须为 `selected`；不一致时抛错（前端应保证一致）
- 每次 run 开始生成 uuid、写 `wiki_ingest_runs` row（status=running）
- 若 `forceReingest=false`：先 `SELECT article_id FROM wiki_ingest_marks WHERE article_id IN (...)` 拿到已打标集合，从 batch 里过滤；过滤掉的计入 `skipped_count` 且发 `ingest.article_skipped` 事件
- 每个 patch apply 后写 `wiki_ingest_run_ops`；apply 成功的 article 写 `wiki_ingest_marks`（upsert）
- run 结束 update `wiki_ingest_runs.status + finished_at + 统计`
- 校验 `maxArticles`：实际要处理数超过时立即抛错、run 记为 error

### 5.3 web-server 新增 / 修改 route

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/kb/wiki/ingest` | body 加 `article_ids?: string[]` / `max_articles?: number` / `force_reingest?: boolean`；保留 SSE |
| POST | `/api/kb/wiki/check-duplicates` | body `{ article_ids: string[] }` → `{ already_ingested: [{article_id, first_ingested_at, last_ingested_at, last_run_id, wiki_paths: string[]}], fresh: string[] }`。`wiki_paths` 来自最近 run 的 ops |
| GET | `/api/kb/wiki/runs?limit=50&account=&since=&until=&status=` | 列 `wiki_ingest_runs` |
| GET | `/api/kb/wiki/runs/:id` | 单 run 详情 + 分组后的 ops |
| GET | `/api/kb/wiki/index.json` | 返回 `[{ path, title, aliases }]`，给前端 auto-link 索引（可被浏览器缓存 60s） |
| GET | `/api/kb/wiki/pages/:path?meta=1` | 在现有 endpoint 加 `meta=1` 分支，返回 `{ frontmatter, body }` JSON；不传 meta 仍返回 raw markdown（向后兼容） |
| GET | `/api/kb/raw-articles/:account/:id` | 新：读 `ref_articles` → `{ title, published_at, url, body_plain, md_path }`；前端 source 抽屉用 |

## 6. 前端组件

### 6.1 新增 / 修改清单

```
packages/web-ui/src/
├─ pages/KnowledgePage.tsx                ── 改：加 ModelSelector 顶栏、加"活动"Tab、改 IngestForm 为 IngestTab
├─ components/wiki/
│   ├─ IngestTab.tsx                      ── 新：D2 布局容器
│   ├─ AccountSidebar.tsx                 ── 新
│   ├─ IngestMain.tsx                     ── 新（AccountHeader + AccountHeatmap + ArticleFilter + ArticleList）
│   ├─ ArticleList.tsx                    ── 新
│   ├─ IngestCartBar.tsx                  ── 新
│   ├─ IngestConfirmDialog.tsx            ── 新
│   ├─ IngestConsoleFab.tsx               ── 新（参考 ProjectWorkbench.ConsoleFab）
│   ├─ IngestActivityView.tsx             ── 新（参考 ProjectActivityView）
│   ├─ IngestResultDialog.tsx             ── 新
│   ├─ IngestRunList.tsx                  ── 新（"活动"Tab 的 run 卡片列表）
│   ├─ ModelSelector.tsx                  ── 新（顶栏）
│   ├─ WikiPagePreview.tsx                ── 改：加 frontmatter footer、auto-link、source 抽屉触发
│   ├─ WikiFrontmatterFooter.tsx          ── 新
│   ├─ RawArticleDrawer.tsx               ── 新
│   ├─ AccountHeatmap.tsx                 ── 改：移除内部勾选 UI，新增 `onRangeSelect` 拖选日期段回调
│   ├─ IngestForm.tsx                     ── 删（职责拆到 IngestTab）
│   └─ IngestProgressView.tsx             ── 删（用 IngestActivityView 替代）
├─ hooks/
│   ├─ useIngestState.ts                  ── 改：状态机扩展 cancelled / skipped 事件 / 聚合 RunState
│   ├─ useWikiIndex.ts                    ── 新：拉取 /api/kb/wiki/index.json，60s 内存缓存
│   └─ useIngestCart.ts                   ── 新：跨账号 CartEntry[] + 超上限标记
└─ api/wiki-client.ts                     ── 改：加 checkDuplicates / listRuns / getRun / getRawArticle / getWikiIndex
```

### 6.2 关键组件 API

```ts
// AccountSidebar
interface AccountSidebarProps {
  accounts: AccountStats[];
  activeAccount: string | null;
  cart: Map<string, number>;  // account -> selected count
  onSelectAccount: (account: string) => void;
}

// ArticleList
interface ArticleListProps {
  articles: Article[];
  duplicates: Set<string>;     // article ids 已在 wiki_ingest_marks
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}

// IngestCartBar
interface IngestCartBarProps {
  entries: CartEntry[];
  maxArticles: number;         // 默认 50
  onClear: () => void;
  onRemove: (id: string) => void;
  onSubmit: () => void;        // 弹 IngestConfirmDialog
}

// IngestConfirmDialog
interface IngestConfirmDialogProps {
  entries: CartEntry[];
  dupCheckResult: DupCheckResult;  // 由 POST /check-duplicates 得到
  defaultModel: { cli; model };
  onConfirm: (payload: IngestPayload) => void;  // payload.force_reingest / article_ids / cli_model
  onCancel: () => void;
}

// WikiPagePreview
interface WikiPagePreviewProps {
  path: string | null;
  onNavigate?: (path: string) => void;        // auto-link / backlink 跳转
  onOpenSource?: (account: string, articleId: string) => void;
}
```

### 6.3 购物车规则

- 切换账号不清空（跨账号持久化，仅组件 state）
- 刷新页面清空（不做 localStorage，避免陈旧脏数据）
- `entries.length > maxArticles` 时 `IngestCartBar` 红警 + `[入库 →]` 禁用
- `IngestConfirmDialog` 内部若"强制重入"切换后超上限，同样禁用

### 6.4 MD 跳转

**A. 实体名 auto-link（正文内）**

- 挂载时 `useWikiIndex()` 拉 `/api/kb/wiki/index.json`（失败静默降级）
- 自定义 `ReactMarkdown` 的 `text` renderer：不在纯字符串上 regex，而是走 ReactMarkdown 节点树，只对 `text` 节点做替换；在 `code` / `link` / `inlineCode` 节点上跳过
- 匹配算法：title + aliases 按长度降序排，对文本做"最长前缀扫描"；命中替换成 `<a href="#" onClick={() => onNavigate(path)}>`
- 排除：页自身的 title 不替换自己（避免自链）

**B. Frontmatter Footer**

- `WikiPagePreview` 改为调 `/api/kb/wiki/pages/:path?meta=1` 拿 `{ frontmatter, body }`
- `<WikiFrontmatterFooter>` 组件渲染三组：
  - `sources` — 每行：account chip + `article_id.slice(0,8)` mono + quoted 斜体；点击触发 `onOpenSource(account, articleId)`
  - `backlinks` — 每条渲染为 Chip（用 `Chip` 组件，variant=neutral soft）；点击触发 `onNavigate(path)`；path 不存在时 Chip 灰掉 + Tooltip "页面已不存在"
  - `images` — 缩略图网格（每行 4 列，64px）+ 点击放大 Lightbox Dialog

**C. Source 原文抽屉**

- `<RawArticleDrawer>` 从右侧滑出 40% 宽（`Dialog` 组件变体，不遮全屏）
- 调 `GET /api/kb/raw-articles/:account/:id`
- 内容：账号 chip + 标题 h2 + 发布时间 + `body_plain`（按 `<pre>` 或简易 markdown 渲染）+ 底部 "打开原 URL ↗" 外链按钮
- 404 时显示"原文档案已清理" + 保留 URL（如 frontmatter 中还有）

### 6.5 入库过程 FAB + Activity（复用）

`IngestConsoleFab` 照搬 `ProjectWorkbench.ConsoleFab`：
- 样式：`fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full border border-[var(--hair)] bg-[var(--bg-1)] shadow-[0_4px_12px_rgba(0,0,0,0.12)]`
- 只在**入库 Tab 激活 且 ingest.status !== "idle"** 时渲染
- hover/active/error 状态：`border-accent-soft` / `animate-pulse 绿点` / `border-red-*`
- 点击打开 `fixed inset-0 z-50` 全屏 `IngestActivityView`

`IngestActivityView` 照搬 `ProjectActivityView` 骨架：
- 顶部：status chip（running/done/error）+ 进度条 + `SseHealthDot` + `[取消]`（running 时）
- 中：ops 日志流（复用 `logSource` 风格，新增 `t.startsWith("ingest.")` 分支映射到 tone）
- 底：汇总（当前批次 / 已 apply ops / 冲突数 / 用时）

**事件到 tone 映射：**

| 事件 | tone |
|---|---|
| `ingest.op_applied` op=upsert | accent |
| `ingest.op_applied` op=append_source / append_image / add_backlink | plain |
| `ingest.op_applied` op=note | meta |
| `ingest.op_applied` 带 error | red |
| `ingest.article_skipped` | amber |
| `ingest.batch_failed` | red |

### 6.6 结果 Dialog

Run 的 `ingest.result` 事件到达后：
- `IngestActivityView` 保持打开（日志仍可查）
- 另外弹出 `<IngestResultDialog>`（`Dialog` 组件）
- 数据来自 `GET /api/kb/wiki/runs/:run_id`
- 分组显示：新建 / 追加 / 冲突 / 跳过；每条可点 `[预览]` 打开对应 wiki 页（切回浏览 Tab + `setSelected(path)`）

### 6.7 活动 Tab

- `IngestRunList` 调 `GET /api/kb/wiki/runs`，按 started_at 倒序
- 每卡显示：时间 · 篇数 · model · 用时 · 统计（新 X / 追加 Y / 冲突 Z）· 状态 chip
- 点 `[查看详情 →]` 打开同一个 `IngestResultDialog`

### 6.8 浏览 Tab 的 NEW 徽章

- pages meta 已返回 `last_ingest`
- 前端在 `visible` map 时判断 `last_ingest > now() - 24h`，在 page card 右上加 `<Chip variant="accent" size="sm">NEW</Chip>`
- kinds filter 同级加一个 `"最近 24h"` chip（激活后只显示 NEW 的 pages）

### 6.9 ModelSelector

- Header 右侧，Menu 组件（Radix dropdown）
- 两级选择：cli（claude / codex）+ model（opus / sonnet / haiku / gpt-5）
- 默认值来自 `GET /api/config`，用户改动写 `POST /api/config/agents`（复用 agent-config-store 现有 key：`wiki.ingestor`）
- 选中值同步 localStorage（key: `crossing:wiki:model`），`IngestConfirmDialog` 读取作为默认
- 显示 tiny chip：`claude/sonnet`

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| Agent 返回不合法 NDJSON | `parseNdjsonOps` 现有 fail-soft；`batch_failed` 事件记录；`conflict_count` 不加 |
| 单个 patch apply 失败 | `try/catch` → `op_applied` 带 error；`wiki_ingest_run_ops.error` 列记录 |
| Run 整体 crash | `runIngest` 外层 catch → `status='error' + error 字段`；已 apply 的保留 |
| SSE 断开 | `useIngestState` 标 disconnected，5s 重试；超 30s 失败则 error |
| 用户取消 | `AbortController.abort()` → SSE 关 + 服务端 `reply.raw.write` 失败即中止；run 状态置 `cancelled` |
| check-duplicates 查不到 | 走 fresh 分支，不阻断流程 |
| Auto-link 索引拉取失败 | 静默降级，正文仍可读 |
| Source 抽屉找不到原文 | "原文档案已清理" + 外链（如有） |
| 单次超上限 | 前端红警 + 禁用；后端 413 + `{ error: "max_articles exceeded", cap: 50, received: 78 }` |
| `mode=selected` 但 `articleIds=[]` | 400 `{ error: "article_ids required for mode=selected" }` |
| 传了 `articleIds` 但 `mode≠selected` | 400 `{ error: "article_ids implies mode=selected" }` |

## 8. 测试策略

### 8.1 后端

- `@crossing/kb`
  - `wiki-store` 三表初始化、`wiki_ingest_marks` upsert 语义
  - `orchestrator.runIngest` 的 `articleIds` 分支、skipped 计数、超上限抛错
  - Agent 调用用现有 fake pattern（不调真实 CLI）
- `web-server`
  - `/api/kb/wiki/ingest` 新字段验证、413 响应
  - `/api/kb/wiki/check-duplicates` 命中 / 未命中 / DB 不存在降级
  - `/api/kb/wiki/runs` + `/:id` 基本读取
  - `/api/kb/wiki/index.json` 返回结构
  - `/api/kb/wiki/pages/:path?meta=1` JSON 响应
  - `/api/kb/raw-articles/:account/:id` + 404

### 8.2 前端

- `KnowledgePage` 三 Tab 切换、顶栏 ModelSelector 渲染
- `AccountSidebar` 点选 + mini 热力图计数
- `ArticleList` 已入库徽章 + 勾选行为
- `useIngestCart` 跨账号 + 超上限标记
- `IngestConfirmDialog` 强制重入 payload 构造
- `WikiPagePreview`
  - backlinks / sources / images 渲染
  - sources 点击触发 `onOpenSource`
  - auto-link：mock wiki index + 含实体名正文片段，断言命中转 `<a>` 且点击触发 `onNavigate`
  - code block / 已有 link 内部不替换
- `IngestConsoleFab` 条件渲染（入库 Tab + non-idle）
- `IngestActivityView` tone mapping 新事件类型

### 8.3 视觉 / 回归

- `?mock=1` 对照（浏览 / 入库 / 活动）
- `pnpm exec tsc --noEmit` 干净
- `pnpm build` 通过
- 手工：浏览 → 入库（跨账号选 7 篇）→ FAB 实时看进度 → 结果 Dialog → 活动 Tab 看历史

## 9. 落地顺序（5 个独立 plan）

| 顺序 | Plan | 可独立合并 | 依赖 |
|---|---|---|---|
| 1 | MD 跳转修复：`WikiPagePreview` 重做 + `WikiFrontmatterFooter` + `RawArticleDrawer` + auto-link index + 后端 `/api/kb/wiki/index.json` / `pages/:path?meta=1` / `raw-articles/:account/:id` | ✓ | 无 |
| 2 | 后端入库粒度 + run 记账：三张表迁移 + `runIngest` 扩 `articleIds/maxArticles/forceReingest` + `/check-duplicates` + `/runs` + `/runs/:id` + ingest body 新字段 | ✓ | 无 |
| 3 | 前端 D2 布局重做：`IngestTab` / `AccountSidebar` / `IngestMain` / `ArticleList` / `IngestCartBar` / `IngestConfirmDialog` / `ModelSelector` / `AccountHeatmap` 职责收窄 | 依赖 2 | 2 |
| 4 | 入库过程可视化：`IngestConsoleFab` + `IngestActivityView` + `useIngestState` 扩展 | 依赖 2 | 2 |
| 5 | 结果与活动：`IngestResultDialog` + `IngestRunList` + 活动 Tab + 浏览 NEW 徽章 | 依赖 2 | 2 |

Plan 1 完全独立可先发。Plan 2 是 3/4/5 的地基。3/4/5 之间可并行。

## 10. 风险

- **Auto-link 性能**：168 页规模下 O(n·m) 可接受，`useMemo` 缓存替换结果；规模上千需 Aho-Corasick，留 TODO 注释不提前优化
- **Run 表膨胀**：每次 run 可能写几十条 ops 行，不做自动清理，历史可长期查；活动 Tab 分页即可
- **模型选择器全局 vs per-run**：默认模型存 localStorage + config；`IngestConfirmDialog` 里仍能临时覆盖本次 run
- **sonnet 默认 vs opus 历史数据的质量漂移**：规则 prompt 不变，agent 行为不会失控；可接受

## 11. 验收标准

- 所有新 `.tsx` 不含硬编码 hex / `bg-white` / `text-red-600` / `bg-gray-*`，只用 `var(--*)` token
- 所有 `<button>` 走 `<Button>` 组件（icon-only 小按钮例外）
- `pnpm exec tsc --noEmit` 干净（不新增 pre-existing 之外错误）
- `pnpm build` 通过
- 手工走完 9 条流：
  1. 浏览 → 选一页 → 看 frontmatter footer 三组都渲染
  2. 点 source → 抽屉打开原文
  3. 正文里的实体名变链接 → 点击切页
  4. 入库 Tab → 左栏点一个账号 → 右侧大热力图 + 列表
  5. 跨账号勾 7 篇 → 底部购物车常驻
  6. 点入库 → ConfirmDialog 若有已入库给提示 → 确认
  7. 右下 FAB 实时进度 → 点开 Activity → 看 ops 流
  8. 结果 Dialog → 点预览跳到 wiki 页
  9. 活动 Tab → 历史 runs 可查
- Plan 1 单独合并后，无需 plan 2 就能看到 MD 跳转修好
- 超过 50 篇前端给红警且后端 413
