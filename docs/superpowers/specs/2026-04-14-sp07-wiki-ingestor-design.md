# SP-07 Wiki + Ingestor 设计稿（Karpathy LLM Wiki 范式）

**日期：** 2026-04-14
**前置：** SP-06 Style Distiller 完成（已有按账号蒸馏的风格卡机制）；refs.sqlite 内有足够原始文章数据
**目标：** 建立 Karpathy 式的"编译型知识库"——原始文章 `raw`（refs.sqlite）→ LLM 增量编译 → 结构化 wiki（entity/concept/case/observation/person 页面 + index + log），供 SP-08 writer agent 用 `search_wiki` skill 直接查用
**范围：** Wiki 目录规约 + Ingestor agent + NDJSON patch 协议 + 自动 index/log 维护 + 只读 `search_wiki` skill + CLI + UI + MVP 对 4 个账号前 50 篇做全量 ingest
**非目标：** writer agent 的 tool-use 接入（SP-08）；`search_raw` skill（SP-08 随 writer 一起做）；质检员 agent（SP-09）；统一配置面板（SP-10）；raw 自动抓取 / 手动导入 / wiki 在线编辑 UI（SP-11+）；wiki 跨页 diff / 历史版本

---

## 1. 背景与决策

SP-06 把"账号风格"蒸馏到了 style-panel。但 writer 写文章时还缺另一条线索：**写什么事实、提到什么产品、引用哪些案例**——这类知识散在几万篇 raw 文章里，RAG 每次临时检索质量不稳。

Karpathy 在 [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 给出了一种新范式：**把知识从 raw 一次性"编译"成持久化 wiki**，LLM 平时只读成熟 wiki 页面而不是每次重新从 raw 起。本期完全照此范式落地到 crossing-writer。

**核心分层（与 SP-06 正交）：**

```
Raw (refs.sqlite)   ← 不变，几万篇原文
     ↓ LLM 编译（本期）
Wiki                ← 按 entity/concept/case/observation/person 组织的 md
                      agent 写作时直接读
Style-Panels        ← SP-06 产物，账号风格卡（与 Wiki 正交）
```

**用户确认的关键设计选择：**

1. Wiki 分类按 Karpathy 范式（`entities/` `concepts/` `cases/` `observations/` `persons/` + `index.md` + `log.md`），不强按写作段（opening/practice/closing）切文件夹；段视角在 `index.md` 里用双索引导航
2. Skills 用 MCP / tool-use（agent 主动调用），不走 RAG 预检索
3. MVP：4 个账号（数字生命卡兹克 / AI产品阿颖 / 卡尔的AI沃茨 / 赛博禅心）× 每账号最近 50 篇，合计 200 篇全量 ingest；第 51 篇起走增量
4. SP-07 + SP-08（wiki + ingestor）合并为本 SP；writer 接入留给 SP-08

## 2. Wiki 目录布局

```
~/CrossingVault/wiki/
├─ CROSSING_WIKI_GUIDE.md              ← Karpathy 的 CLAUDE.md 等价物：规约文件
├─ index.md                            ← LLM 维护的两套索引（按 kind / 按主题）
├─ log.md                              ← append-only，每次 ingest 记录改动
├─ entities/                           ← 具体可命名的实体（产品/工具/公司/机构）
│   ├─ PixVerse-C1.md
│   ├─ LibTV.md
│   ├─ OpenClaw.md
│   └─ 阿里通义.md
├─ concepts/                           ← 抽象概念/技法/模式/行业判断
│   ├─ AI漫剧.md
│   ├─ 多Agent编排.md
│   └─ 垂直模型分工.md
├─ cases/                              ← 可复用的实测案例（含 prompt + 结构 + 素材）
│   ├─ PixVerse-C1_多宫格分镜.md
│   └─ LibTV_角色一致性.md
├─ observations/                       ← 可引用的事实素材（含图/数据/出处）
│   ├─ AI漫剧播放量25亿.md
│   └─ 垂直模型赛道分化.md
└─ persons/                            ← 人物页（作者/产品人/投资人/KOL）
    ├─ 镜山.md
    ├─ Koji.md
    └─ 某产品负责人.md
```

每页顶部 frontmatter（所有 kind 共用基础字段 + 按 kind 扩展）：

```yaml
---
type: entity | concept | case | observation | person
title: PixVerse-C1
aliases: [PixVerse, C1]
sources:
  - account: 十字路口Crossing
    article_id: 2026-04-08_AI-漫剧爆了
    quoted: "C1 的多宫格分镜能力..."
  - account: 数字生命卡兹克
    article_id: 2026-03-15_模型实测
    quoted: "..."
backlinks:
  - concepts/AI漫剧.md
  - cases/PixVerse-C1_多宫格分镜.md
images:
  - url: https://mmbiz.qpic.cn/mmbiz_png/xxx.png
    caption: "C1 生成的分镜截图"
    from_article: 2026-04-08_AI-漫剧爆了
last_ingest: 2026-04-14T10:30:00Z
# —— 按 kind 的扩展字段（可选）——
# entity:
category: product | tool | company | org
# case:
prompt_text: "..."          # 原 prompt 原样
structure: [scene1, scene2] # 分节
# observation:
fact: "AI 漫剧播放量 25 亿次"
data_point:
  value: 2500000000
  unit: 次
  as_of: 2026-春节
  source: Monnfox
# person:
role: 作者/产品人/投资人
affiliation: 十字路口Crossing
---

# <title>

正文 markdown。可以 include 图片（从 images 引用）和 backlink。
```

## 3. CROSSING_WIKI_GUIDE.md（规约）

写死在 wiki/ 根目录的一份说明文档，Ingestor 在 system prompt 里 reference 它作为"规矩"。主要内容：

1. 分页原则：
   - 一个具体产品/工具 / 公司 / 机构 / SDK = 1 `entities/` 页
   - 一个抽象概念 / 技法 / 行业判断 / 模式 = 1 `concepts/` 页
   - 一次具体的实测 case（prompt + 结构 + 素材） = 1 `cases/` 页
   - 一个可独立引用的事实 / 数据点（带出处） = 1 `observations/` 页
   - 一个人（作者、产品人、投资人、KOL） = 1 `persons/` 页
2. 命名：中文 title 直接作文件名（保留中文字符），空格替换为 `-`，避免 `/` 和 `:`
3. 去重优先：新文章读到已有 entity（alias 匹配）→ update，不新建
4. 每条 source 必须带 `article_id` + 原句 `quoted`（供 writer 引用时带出处）
5. 冲突处理：同一事实两篇文章说法不一 → 页面内标 `<!-- conflict -->` 段并写双方
6. Backlink 原则：概念页提到某实体 → 在该实体的 backlinks 加反链；case 里出现的 entity 同理
7. 禁止：主观评价、LLM 生成的"总结文字"不能掩盖原文；`sources` 必填；`images` 只能从 raw 里提取，不编造 URL

## 4. Ingestor Agent

新增 `packages/agents/src/roles/wiki-ingestor-agent.ts`：

### 4.1 输入

```ts
interface IngestorInput {
  account: string;
  batchIndex: number;
  totalBatches: number;
  articles: Array<{
    id: string;
    title: string;
    published_at: string;
    body_plain: string;
    images?: Array<{ url: string; caption?: string }>;   // 从 raw html 预提取
  }>;
  existingWikiSnapshot: {
    index_md: string;          // 当前 wiki/index.md
    pages: Array<{             // 与本批 raw 可能相关的现有页面（宿主预 grep 出 top-K）
      path: string;            // 相对 wiki/ 的路径
      frontmatter: Record<string, unknown>;
      first_chars: string;     // 前 500 字 preview
    }>;
  };
  wikiGuide: string;           // CROSSING_WIKI_GUIDE.md 内容
}
```

### 4.2 System prompt（要点）

- 你是 wiki 编译师，按 `CROSSING_WIKI_GUIDE.md` 的规约维护 wiki
- 输入是一批文章，你要决定这批文章带来哪些"变更"
- 输出是 NDJSON 指令列表（一行一指令），宿主会按顺序 apply
- 已有页面能更新就更新，不随便新建；新建要先解释为什么不复用
- 每条 source 必须带 `article_id` 和 `quoted` 原文片段
- 直接输出 NDJSON，第一字符是 `{`，最后字符是 `}`，不要前言/说明/代码围栏

### 4.3 输出 NDJSON patch 协议

```ndjson
{"op":"upsert","path":"entities/PixVerse-C1.md","frontmatter":{...},"body":"..."}
{"op":"upsert","path":"concepts/AI漫剧.md","frontmatter":{...},"body":"..."}
{"op":"append_source","path":"entities/PixVerse-C1.md","source":{"account":"...","article_id":"...","quoted":"..."}}
{"op":"append_image","path":"entities/PixVerse-C1.md","image":{"url":"...","caption":"...","from_article":"..."}}
{"op":"add_backlink","path":"concepts/AI漫剧.md","to":"entities/PixVerse-C1.md"}
{"op":"note","body":"本批未产生新 entity；PixVerse-C1 已存在，追加 1 个 source"}
```

**支持的 op：**
- `upsert` — 整页覆盖 / 创建（body 是 markdown 正文，不含 frontmatter；frontmatter 字段由 op 单独携带）
- `append_source` — 只向某页 `sources` 列表追加一项
- `append_image` — 只向某页 `images` 列表追加一项
- `add_backlink` — 在目标页 `backlinks` 加一项；宿主会自动反向建立
- `note` — 给 log.md 加一行注释（agent 想说明意图时用）

其他 op（`delete`/`rename`）本期不开放，避免 agent 误操作；人工修订走直接编辑 md。

### 4.4 Prompt 上的 FAIL-SOFT 约束

- 每批输出 NDJSON，坏行宿主**跳过不报死**（沿用 SP-06 snippets 的经验）
- 一批完全无有效 op → 记 log.md "empty batch"，继续下一批
- 一批超预算 → 仅 apply 前 N 条 + 记 log

## 5. Ingest Pipeline（宿主代码）

`packages/kb/src/wiki-ingestor/`:

```
types.ts                    ← IngestorInput / PatchOp / IngestResult
wiki-store.ts               ← 文件读写 + frontmatter serialize/parse + apply patch
wiki-snapshot.ts            ← 根据本批 articles 预 grep 出"可能相关的现有页面"（top-K）
orchestrator.ts             ← runIngest(opts): 分批调 Ingestor → apply → 更新 index/log
index-maintainer.ts         ← 纯代码重建 index.md（按 type 列表 + 按 backlink 热度排序）
raw-image-extractor.ts      ← 从 refs.sqlite 或对应 article md 里抽 <img> URL
```

### 5.1 主流程

```ts
export interface IngestOptions {
  accounts: string[];                  // ["数字生命卡兹克", ...]
  perAccountLimit: number;             // 50（MVP）
  batchSize: number;                   // 5-8（调用 token 平衡）
  since?: string; until?: string;      // 可选时间过滤（同 SP-06）
  cliModel?: { cli: "claude"|"codex"; model?: string };  // 默认 claude/opus
  onEvent?: (ev: IngestStepEvent) => void;
  mode: "full" | "incremental";        // full=取前 N 篇；incremental=从上次 log.md 记录之后的新文章
}

export async function runIngest(opts: IngestOptions, ctx: { vaultPath: string; sqlitePath: string }): Promise<IngestResult>
```

流程：
1. 对每个 account：
   - 读 refs.sqlite 取对应 N 篇（或 incremental 读 log.md 里已登记的 max published_at 之后的新文章）
   - 分批
   - 对每批：
     - 从 refs.sqlite 取文章 body_plain + images（存在的 html 抽）
     - 从 wiki/ 预扫描出与本批 title/keyword 最相关的现有页面（top-K=10 靠 simple keyword matching / 先期用 FTS on frontmatter.title + aliases）
     - 调 WikiIngestorAgent
     - 解析 NDJSON → apply via wiki-store
     - 每 op 发 `ingest.op_applied` SSE event
2. 跑完所有批次 → 重建 index.md（按 kind 组织 + 按主题组织双索引）→ append log.md 本次 ingest 条目
3. 返回 IngestResult { accounts_done, pages_created, pages_updated, sources_appended }

### 5.2 SSE events

- `ingest.batch_started` `{account, batchIndex, totalBatches, articles_in_batch}`
- `ingest.op_applied` `{op, path}`
- `ingest.batch_completed` `{account, batchIndex, ops_applied, duration_ms}`
- `ingest.batch_failed` `{account, batchIndex, error}`（单批 fail 不中断，继续）
- `ingest.account_completed` `{account, articles_processed, pages_created, pages_updated}`
- `ingest.all_completed` `{accounts_done, total_pages}`

## 6. `search_wiki` Skill（只读）

`packages/kb/src/skills/search-wiki.ts`：

```ts
export interface SearchWikiInput {
  query: string;
  kind?: "entity" | "concept" | "case" | "observation" | "person";
  limit?: number;       // default 5
}

export interface SearchWikiResult {
  path: string;
  kind: string;
  title: string;
  aliases: string[];
  excerpt: string;      // 前 300 字
  frontmatter: Record<string, unknown>;
  score: number;
}

export async function searchWiki(opts: SearchWikiInput, ctx: { vaultPath: string }): Promise<SearchWikiResult[]>;
```

实现：
- 启动时扫 wiki/**/*.md → 构建 in-memory index：`(title + aliases + first_500_chars)` tokenize + 倒排
- 查询：keyword 分词 → score via TF-IDF 简化版 → 按 kind 过滤 → top-K
- 每次 wiki 变更后 invalidate + 重建（文件少，<10ms）

MVP 不用 sqlite FTS（200 篇文章产的 wiki 页数级估算 100-500 页，纯内存索引够）。后续规模变大再加持久化 FTS。

**Skill 如何被 agent 调：** SP-08 接入 writer 时会实现 tool dispatcher；本 SP 只导出 `searchWiki` 函数供 SP-08 复用。

本 SP 要测的：
- `searchWiki({ query: "AI 漫剧" })` 返回 `concepts/AI漫剧.md` + `entities/PixVerse-C1.md` 等相关页
- `kind` 过滤正确
- 空 wiki 返回 `[]`

## 7. 后端 API

| Method | Path | 语义 |
|---|---|---|
| POST | `/api/kb/wiki/ingest` | body: `{ accounts, per_account_limit, batch_size, mode, cli_model, since, until }`；派发 runIngest；SSE 流 |
| GET | `/api/kb/wiki/pages` | 列出 wiki 所有页面 meta（path + frontmatter 摘要）；前端浏览用 |
| GET | `/api/kb/wiki/pages/*` | 读单页原始 md |
| GET | `/api/kb/wiki/search` | query string `q=`, `kind=`, `limit=` — 调 `searchWiki` 返回结果；前端搜索框用 |
| GET | `/api/kb/wiki/status` | 当前 wiki 统计：总页数 / 各 kind 数 / 按账号最近 ingest 时间 |

**400/404 校验：**
- `accounts` 空数组 → 400
- 任一 account 不在 refs.sqlite → 404
- `per_account_limit` < 1 或 > 500 → 400
- `batch_size` < 1 或 > 20 → 400

## 8. 前端：新 `/knowledge` 页面

路由 `/knowledge`（顶栏加入口"知识库"，与"风格面板"并列）：

### 8.1 Tab 1: Wiki 浏览（默认）

```
┌ 左栏：tree ─────────┬ 右栏：页面预览 ────────────────┐
│ 🔍 [搜索框]         │                                │
│                     │  # PixVerse-C1                 │
│ 📊 统计：           │                                │
│   entity: 24        │  rendered markdown             │
│   concept: 11       │                                │
│   case: 8           │  sources:                      │
│   observation: 15   │  - 十字路口 / 2026-04-08       │
│   person: 6         │  - 数字生命 / 2026-03-15       │
│                     │                                │
│ ▸ entities/         │  backlinks:                    │
│   PixVerse-C1       │  → concepts/AI漫剧              │
│   LibTV             │  → cases/PixVerse-C1_多宫格    │
│ ▸ concepts/         │                                │
│ ▸ cases/            │  [frontmatter JSON 折叠]       │
│ ▸ observations/     │                                │
│ ▸ persons/          │                                │
│ ─────               │                                │
│ [查看 index.md]     │                                │
│ [查看 log.md]       │                                │
└─────────────────────┴────────────────────────────────┘
```

- 左栏 tree：按 kind 分组，每项展开显示页面数
- 右栏：ReactMarkdown 渲染，backlink 可点跳转（更新 URL 内部路由 state）
- 顶部搜索框：输入关键词 → 调 `/api/kb/wiki/search` → 下拉显示 top-5 结果，点进跳转

### 8.2 Tab 2: Ingest

```
┌ Ingest 配置 ─────────────────────────────────────────┐
│                                                       │
│  账号选择（多选）：                                    │
│    ☑ 数字生命卡兹克 (1251 篇)                          │
│    ☑ AI产品阿颖 (1229 篇)                              │
│    ☑ 卡尔的AI沃茨 (xxx 篇)                             │
│    ☑ 赛博禅心 (xxx 篇)                                 │
│    ☐ 量子位 (1982 篇)                                  │
│    ... （refs.sqlite 里其他账号）                       │
│                                                       │
│  模式：  (•) 全量前 N 篇   ( ) 增量                    │
│  N:     [50]       batch_size: [5]                    │
│  时间过滤：since [    ] until [    ]（可空）            │
│                                                       │
│  agent 配置：                                          │
│    ingestor cli: [claude ▾]  model: [opus]             │
│                                                       │
│  [开始 Ingest]  [取消]                                 │
└───────────────────────────────────────────────────────┘

  开始后切 ProgressView（仿 SP-06），实时 SSE log：
  [数字生命卡兹克] batch 1/10 → 5 ops applied
  [数字生命卡兹克] batch 2/10 → 3 ops applied
  ...
```

### 8.3 组件结构

```
packages/web-ui/src/pages/KnowledgePage.tsx
packages/web-ui/src/components/wiki/
├─ WikiBrowser.tsx          ← Tab 1 主容器
├─ WikiTree.tsx             ← 左栏 tree
├─ WikiPagePreview.tsx      ← 右栏 markdown 预览
├─ WikiSearchBox.tsx        ← 顶部搜索框
└─ wiki/
   ├─ IngestForm.tsx         ← Tab 2 配置表单
   └─ IngestProgressView.tsx ← Tab 2 SSE 日志
packages/web-ui/src/api/wiki-client.ts
```

## 9. CLI

新 subcommand（同 SP-06 沿用 `pnpm crossing-kb`）：

```bash
# 浏览
pnpm crossing-kb wiki status
pnpm crossing-kb wiki search "AI 漫剧"
pnpm crossing-kb wiki show entities/PixVerse-C1

# Ingest
pnpm crossing-kb wiki ingest \
  --accounts "数字生命卡兹克,AI产品阿颖,卡尔的AI沃茨,赛博禅心" \
  --per-account 50 \
  --batch-size 5 \
  --mode full

pnpm crossing-kb wiki ingest --accounts "数字生命卡兹克" --mode incremental
```

## 10. 错误处理

- **Ingestor 单批 NDJSON parse 全失败**：log.md 记 "empty batch"，继续
- **单 op apply 失败**（比如文件系统错误）：skip + log，继续其他 op
- **文章 id 重复 source**：`append_source` 幂等（相同 article_id 不重加）
- **backlink 循环**：忽略（自引用/双向循环都不报错，只是不追加）
- **UI 断连**：orchestrator 跑完照常完成；ingest 结束后刷新 wiki 即可

## 11. 测试策略

约 30-35 tests。保持前序 SP 全部不回归。

| 模块 | 用例 |
|---|---|
| `wiki-store.ts` | frontmatter parse/serialize / apply `upsert` / `append_source` / `append_image` / `add_backlink` 幂等性 / invalid path rejection |
| `wiki-snapshot.ts` | 按 title/alias 关键词 grep top-K 正确 |
| `index-maintainer.ts` | 纯代码重建 index.md 格式 / 两套索引（按 kind / 按主题）生成正确 |
| `raw-image-extractor.ts` | 从 article html 抽 `<img>` 正则正确，相对/绝对 url 处理 |
| `wiki-ingestor-agent.ts` | mock invokeAgent，验证 prompt 带样本 + wiki snapshot + guide；NDJSON 解析 OK；坏行 skip |
| `orchestrator.ts` | 4 账号 × batch 串行；batch 失败继续；全流程 apply patch 后 index/log 正确 |
| `searchWiki` | keyword match / kind filter / 空 wiki 返回 `[]` / 多 kind 混排 score |
| routes | POST /ingest SSE / GET /pages / GET /pages/* / GET /search / GET /status / 400-404 参数校验 |
| UI 组件 | WikiTree 分组渲染 / WikiSearchBox debounce / WikiPagePreview 渲染 frontmatter + backlink / IngestForm 提交 / IngestProgressView SSE log |
| e2e | mock ingestor → 4 账号 × 10 文章 × 2 批 → wiki/ 下生成预期 entity/concept/case 文件 + index.md + log.md |

## 12. 估算

3-4 天 / 18-22 个 TDD task：

| M | tasks | 内容 |
|---|---|---|
| M1 Wiki 基础（存储 + schema） | 3 | wiki-store / index-maintainer / raw-image-extractor |
| M2 Ingestor Agent + prompt | 2 | ingestor agent + CROSSING_WIKI_GUIDE.md seed |
| M3 Orchestrator | 2 | 主流程 + incremental mode |
| M4 search_wiki skill | 2 | 内存索引 + 搜索函数 |
| M5 后端路由 | 3 | POST /ingest / GET wiki pages+search+status |
| M6 CLI | 2 | wiki ingest / wiki search/show/status |
| M7 前端（Tab 1 浏览） | 4 | wiki-client / WikiTree / WikiPagePreview / WikiSearchBox |
| M8 前端（Tab 2 ingest） | 2 | IngestForm / IngestProgressView |
| M9 集成 + e2e | 2 | KnowledgePage 拼装 + e2e 测试 |

## 13. Future Work（明确不做）

- **search_raw skill**（FTS over refs.sqlite） → SP-08 随 writer 一起做
- **Writer agent tool-use 接入** → SP-08
- **质检员 agent** → SP-09
- **人工 @skill 注入**（人在编辑器选中段落主动调 search_wiki） → SP-08
- **统一配置面板**（合并 SettingsDrawer + DistillForm + WriterConfigForm + IngestForm） → SP-10
- **Raw 自动抓取 / 手动导入工作台** → SP-11+
- **Wiki 在线编辑 UI**（本期只读浏览） → 远期；编辑走"改 md 文件后重新 ingest"
- **Wiki 版本/历史/diff** → 远期；现有 log.md 只记改动行数，不存快照
- **跨 account 冲突自动合并** → 远期；本期标 `<!-- conflict -->` 留人工判
- **图像存档**（本期 wiki 只存 image URL，不下载/缓存） → 远期
- **多语言 wiki** → 远期

## 14. 交付物

1. 本 spec 提交 git
2. 实施计划 `docs/superpowers/plans/2026-04-14-sp07-wiki-ingestor.md`
3. 18-22 个 TDD task
4. 完成后人工 smoke：对 4 账号（数字生命卡兹克 / AI产品阿颖 / 卡尔的AI沃茨 / 赛博禅心）各 ingest 前 50 篇，验证：
   - `wiki/` 目录下 entity / concept / case / observation / person 至少各有若干页
   - `index.md` 两套索引可读
   - `log.md` 记录了每次 ingest 的 op 数
   - UI 浏览左栏 tree 正常，点页面右栏渲染正确，搜索框 OK
   - CLI `wiki search "AI 漫剧"` 返回至少一条
