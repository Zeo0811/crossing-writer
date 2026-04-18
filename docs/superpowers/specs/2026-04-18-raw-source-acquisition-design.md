# 原素材获取（Source Abstraction + Acquisition Console）Design

**Status:** Draft
**Last updated:** 2026-04-18
**Author:** Koji

## Goal

扩展知识库原始素材来源，从「只有微信公众号文章」变成「公众号 + X.com 博主/公司 + AI 外网站点」三源统一。提供一个新的「原素材获取」console 供用户管理监控源列表、手动触发抓取，并把抓到的内容落到现有 `ref_articles` 系统，供既有的入库 / wiki ingestor 流程直接消费。

这是一个更大迭代的**第一个子项目（Sub-project 1：源抽象 + 原素材获取面板）**。后续的 Sub-project 2（X.com 抓取器实现）与 Sub-project 3（AI 外网抓取器实现）各自独立 spec → plan → 实现。

## Scope

**In scope**
- `ref_articles` 表加 `source_kind` 字段
- `sources.yaml`（`~/CrossingVault/sources.yaml`）作为三类监控源的单一真源
- 新前端组件 `SourceFetchFab` / `SourceFetchConsole`（知识库页右上入口，全屏覆盖，segment 切换三源）
- 既有 `IngestTab`（入库 console）顶部加 segment，按 `source_kind` 过滤账号 / handle / 站点
- 后端 API：读写 `sources.yaml`、spawn 抓取 CLI subprocess 并 SSE 流式返回进度
- 抓取 CLI 骨架 `crossing-kb scrape --source {wechat|x|web}`（三类 dispatcher）—— 具体每类的抓取器实现交给 Sub-project 2/3
- cursor 存储 `~/CrossingVault/.index/fetch-cursor.json`
- 纯手动触发（UI 点按钮）。调度（launchd / cron）明确作为 Phase 2，不在本 spec 范围

**Out of scope**
- X 和外网的具体抓取实现（各自独立 spec）
- 调度自动化（Phase 2）
- 监控大盘 / 趋势图表
- 源可靠性健康检查（后续）

## Success Criteria

1. 用户能在知识库主页点一个按钮进入「原素材获取」console，看到三个 segment
2. 三个 segment 各自展示 `sources.yaml` 对应类别的监控列表，能在 UI 里 + / − 增删
3. 点击「拉取全部」或「拉取选中」后，SSE 日志流式显示每个源的抓取进度，新文章落到 `ref_articles`（`source_kind` 正确标注）
4. 现有入库 console 顶部 segment 能切换三类源；切换后账号网格 / 热力图 / 文章列表按源类型过滤
5. Obsidian 用户能直接编辑 `sources.yaml`，UI 刷新后看到变化（双向一致）
6. 既有 wechat 流程完全不受影响（`source_kind = 'wechat'` 为默认）

## Architecture

### 三个面板，两个流程，一份 `ref_articles`

```
┌────────────────────────────────────────────────────────────────┐
│ 知识库主页 [KnowledgePage]                                    │
│   Header: 知识库  [入库+N]         [原素材获取]  [模型] [☾]  │
│   Body:   浏览已入库的 wiki 页                                │
└────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌──────────────────────┐   ┌────────────────────────────────┐
│ 入库 console (现有)  │   │ 原素材获取 console (新)        │
│ IngestTab +          │   │ SourceFetchConsole             │
│ IngestConsoleFab     │   │                                │
│                      │   │ seg: 公众号 / X / 外网         │
│ seg: 公众号/X/外网   │   │                                │
│                      │   │ 上: 源列表 CRUD                │
│ 选 ref_articles →    │   │ 下: [拉取] + SSE 日志         │
│ 推 wiki pages        │   │                                │
│                      │   │ 爬虫 → ref_articles           │
└──────────────────────┘   └────────────────────────────────┘
         │                              │
         └────────────┬─────────────────┘
                      ▼
              ┌────────────────┐
              │ ref_articles   │
              │ + source_kind  │
              │ + 10_refs/..   │
              └────────────────┘
```

两个流程严格解耦：
- **入库流程（现有）**：选择 `ref_articles` 里已有文章 → wiki ingestor → wiki pages
- **原素材获取流程（新）**：爬虫 → 新文章落 `ref_articles` → 等待入库流程消费

## Data Model

### DB schema change

`ref_articles` 表新增一列：

```sql
ALTER TABLE ref_articles ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'wechat';
CREATE INDEX idx_refs_source_kind ON ref_articles(source_kind);
```

合法值：`'wechat' | 'x' | 'web'`。默认 `'wechat'`，所以现有数据迁移零成本。

### Disk layout

沿用现有 `10_refs/<account>/<year>/<date>_<title>_<hash>.{md,html}` 模式：

```
10_refs/
├── 量子位/2026/2026-04-17_xxx_hash.{md,html}      ← source_kind=wechat
├── …
├── x/
│   ├── sama/2026/2026-04-17_stub_tweetid.{md,html}    ← source_kind=x
│   └── karpathy/2026/…
└── web/
    ├── anthropic-blog/2026/2026-04-17_title_hash.{md,html}  ← source_kind=web
    └── simon-willison/2026/…
```

### Frontmatter

两个字段分工清楚：

- `source_kind`（新，DB + frontmatter 都有）：**粗粒度分类**，用于 UI segment / 目录分桶 / DB 过滤。取值只能是 `wechat` / `x` / `web`
- `source`（现有，只在 frontmatter）：**细粒度来源标识**。现有值 `wechat_mp`；后续可出现 `x`、`x_reply`、`web_rss`、`web_html` 等

X 文章示例：

```yaml
---
type: ref_article
source_kind: x             # 新，用于 UI / DB 过滤
source: x                  # 现有字段，未来可细分成 x_reply / x_thread
account: sama              # X handle / 公众号名 / site slug
title: "GPT-5 will change everything"   # 单 tweet 取前 40 字符
author: "Sam Altman"
published_at: 2026-04-17
url: "https://x.com/sama/status/1234567890"
cover: null
summary: null
word_count: 250
topics_core: []
topics_fine: []
ingest_status: raw
html_path: "2026-04-17_stub_1234567890.html"
---

（body 正文）
```

X/外网用不到的字段（如 `is_original`、`position`）留 null 或省略。

### X thread 聚合策略

- 用 twscrape `conversation_id` / `in_reply_to_tweet_id` 判断 thread
- 一个 thread（多条 tweet，同一作者，首条无 `in_reply_to` 或其 parent 属于其他用户）→ 一条 ref_article
- 孤立 tweet（不是 thread 也不在 thread 中）→ 也是一条 ref_article
- `body_plain` 拼接：thread 内每条 tweet 用两个空行分隔，保持阅读顺序
- `url` 用 thread 首条 tweet 的 URL
- 暂不存结构化 `tweets_json`（YAGNI），以后 wiki ingestor 如需细粒度再加

### Web article 处理

- 有 RSS：以 feed 条目为单位，fetch HTML → `turndown` 转 markdown → 写双文件
- 无 RSS：抓 HTML 列表页解析链接 → 逐条 fetch article HTML → 转 md
- 图片 URL 保持原始 http(s) 链接，不下载（跟 wechat 一致，由渲染端 `no-referrer` 处理防盗链）

## Source Management

### `~/CrossingVault/sources.yaml`

vault 顶层的 YAML 文件，Obsidian 可直接编辑，git 跟踪。

```yaml
version: 1

wechat:
  - 量子位
  - 新智元
  - 十字路口Crossing
  # …

x:
  - handle: sama
    note: "OpenAI CEO"
  - handle: karpathy
    note: "前 Tesla AI / OpenAI，AI 教育"
  - handle: AnthropicAI
    note: "Anthropic 官号"
  # …

web:
  - name: "Anthropic Blog"
    url: "https://www.anthropic.com/news"
    rss: "https://www.anthropic.com/rss.xml"
  - name: "Simon Willison"
    url: "https://simonwillison.net"
    rss: "https://simonwillison.net/atom/everything/"
  # …
```

### 种子默认（首次运行时 seed）

**wechat** — 沿用用户现有的列表（已在 `ref_articles.account` 里）

**x（≈ 45 handles）**
- 厂商官号（12）：`@AnthropicAI` `@OpenAI` `@GoogleDeepMind` `@MistralAI` `@xai` `@HuggingFace` `@perplexity_ai` `@cursor_ai` `@togethercompute` `@groqinc` `@cohere` `@Replicate`
- 创始人 / 高管（11）：`@sama` `@dario_amodei` `@demishassabis` `@arav_ind_srinivas` `@gdb` `@satyanadella` `@elonmusk` `@miramurati` `@JohnSchulman2` `@lexfridman` `@jensenhuang`
- 研究员 / 意见领袖（12）：`@karpathy` `@ylecun` `@geoffreyhinton` `@AndrewYNg` `@hardmaru` `@jeremyphoward` `@simonw` `@swyx` `@jxnlco` `@alexalbert__` `@polynoamial` `@percyliang`
- 产品 demo / 开发者秀（6）：`@mckaywrigley` `@omarsar0` `@_akhaliq` `@rauchg` `@hwchase17` `@levelsio`
- 中文 AI 圈：留空，用户在 UI 里自己添加

**web（≈ 27 个）**
- 厂商研究博客（9）：Anthropic / OpenAI Research / Google DeepMind / Meta AI / Mistral / Hugging Face / Microsoft Research / Cohere / Scale AI
- 研究机构（4）：Allen AI / MIT Tech Review (AI) / Stanford HAI / Berkeley AI Research (BAIR)
- 个人/小团队（10）：Simon Willison / Lilian Weng / Latent Space / Interconnects / Sebastian Raschka / Chip Huyen / Import AI / The Batch / Matt Rickard / Vicki Boykis
- 聚合新闻（4）：TLDR AI / Smol.AI News / The Neuron Daily / Ben's Bites

Seed 实现：第一次运行时如果 `sources.yaml` 不存在，从 CLI 内置的种子模板创建；之后用户在 UI 或 Obsidian 里编辑都是 authoritative。

### Cursor（增量抓取状态）

`~/CrossingVault/.index/fetch-cursor.json`：

```json
{
  "version": 1,
  "x": {
    "sama": { "since_id": "1234567890123456789", "last_fetched_at": "2026-04-18T03:00:00Z" },
    "karpathy": { "since_id": "…", "last_fetched_at": "…" }
  },
  "web": {
    "anthropic-blog": { "last_guid": "abc", "last_fetched_at": "2026-04-18T03:00:00Z" }
  },
  "wechat": {}
}
```

- 抓取成功且 ref_articles 写入提交后，才更新对应源的 cursor（保证幂等）
- 写入用临时文件 + `rename()` 保证原子性
- wechat 继续走现有 `tools/bulk_import` 流程，cursor 对它是 no-op

## Scraper Backend

### 统一 CLI 入口

`crossing-kb scrape` 子命令（新增，在现有 `packages/kb/src/cli.ts`）：

```
crossing-kb scrape --source wechat --accounts 量子位,新智元
crossing-kb scrape --source x --handles sama,karpathy [--since-id auto]
crossing-kb scrape --source web --sites anthropic-blog,simon-willison
crossing-kb scrape --all                 # 按 sources.yaml 跑全部
```

所有 scraper 事件通过 NDJSON 写 stdout（跟现有 wiki ingest agent 一个风格）：

```json
{"type":"scrape_started","source":"x","handle":"sama"}
{"type":"article_fetched","source":"x","handle":"sama","article_id":"…","title":"…"}
{"type":"article_skipped","source":"x","handle":"sama","reason":"duplicate","article_id":"…"}
{"type":"scrape_failed","source":"x","handle":"sama","error":"…"}
{"type":"scrape_completed","source":"x","handle":"sama","stats":{"fetched":3,"skipped":1}}
```

web-server 的 `/api/kb/scrape` endpoint spawn 这个 CLI、转发 NDJSON → SSE（同现有 `/api/kb/wiki/ingest` 机制）。

### 三类 scraper 的分工

**wechat scraper** — dispatcher 调用现有 `tools/bulk_import`。不改变现有流程，只是统一入口。

**x scraper**（Sub-project 2）— 本 spec 只定义接口：
- 入参：`--handles <list>` 或 `--all`
- 依赖：twscrape（Python），用户自己登录的账号池
- 输出：thread / tweet → md/html 双文件 → 插 `ref_articles`
- 实现细节交给 Sub-project 2

**web scraper**（Sub-project 3）— 本 spec 只定义接口：
- 入参：`--sites <list>` 或 `--all`
- 对每个 site：RSS 优先，fallback HTML scrape
- 依赖：Node（`rss-parser` / `cheerio` / `turndown`）
- 输出：每条 → md/html 双文件 → 插 `ref_articles`
- 实现细节交给 Sub-project 3

## API

### 读写 sources.yaml

```
GET  /api/kb/sources        → 返回整个 sources.yaml（JSON 化）
PUT  /api/kb/sources        → 写回整个 sources.yaml（body = JSON，server 序列化成 YAML 保存）
```

写入实现：读最新 disk 版本（防止并发丢失），合并或覆盖，临时文件 + rename 原子写。

### 触发抓取

```
POST /api/kb/scrape
  body: {
    source: "x" | "web" | "wechat" | "all",
    selectors?: string[]       // handles / sites / accounts 列表；不传则 --all
  }
  response: SSE stream (NDJSON events)
```

同现有 `/api/kb/wiki/ingest` 路由机制，复用 `reply.hijack()` + `reply.raw.write('event: ...\ndata: ...\n\n')`。

### 读取 cursor（展示用）

```
GET /api/kb/scrape/cursor → 返回 fetch-cursor.json
```

可选，UI 如要在源列表旁显示"上次拉取 2h 前"再加。

## Frontend

### `KnowledgePage` 顶部新按钮

```tsx
<header>
  <h1>知识库</h1>
  <Button variant="primary">入库+N</Button>   {/* 现有 */}
  <span className="flex-1" />
  <Button variant="secondary">原素材获取</Button>   {/* 新 */}
  <ModelSelector />
  <ThemeToggle />
</header>
```

点「原素材获取」→ 打开 `SourceFetchConsole`（full-screen fixed inset-0，复用 `IngestConsoleFab` 视觉壳）。

### `SourceFetchConsole` 布局

```
┌────────────────────────────────────────────────────────┐
│ 原素材获取              [☾] [✕]                       │
├────────────────────────────────────────────────────────┤
│ [公众号] [X 博主] [AI 外网]     ← segment             │
├────────────────────────────────────────────────────────┤
│ 监控列表（以 X 举例，45 handles）                      │
│ ┌────────────────────────────────────────────────┐   │
│ │ ☐ @sama  · OpenAI CEO           [拉取次数/上次时间]│   │
│ │ ☐ @karpathy  · 前 Tesla AI …                   │   │
│ │ ☐ @ylecun  · Meta Chief AI …                   │   │
│ │ …                                              │   │
│ └────────────────────────────────────────────────┘   │
│ [+ 添加 handle]                                        │
├────────────────────────────────────────────────────────┤
│ [拉取全部] [拉取选中]      {running indicator}         │
│                                                        │
│ 日志区（NDJSON 事件流，自动滚底）                     │
│ [03:12:30] started x@sama                              │
│ [03:12:32] fetched: "GPT-5 will…" (tweet 1234…)        │
│ [03:12:32] skipped: duplicate 1233… (cursor hit)       │
│ [03:12:33] completed x@sama · 3 fetched / 1 skipped    │
│ ...                                                    │
└────────────────────────────────────────────────────────┘
```

三个 tab（公众号 / X / 外网）布局一致，只是"监控项"的字段列不同：

- **公众号**：账号名 / 文章数 / 上次拉取
- **X 博主**：handle / note / 上次 tweet 时间 / since_id
- **AI 外网**：name / url / rss / 上次 guid

### `IngestTab` 加 segment

```tsx
<IngestTab>
  <div className="segment">
    <button>公众号</button>
    <button>X 博主</button>
    <button>AI 外网</button>
  </div>
  {/* AccountSidebar / AccountGrid / AccountHeatmap 按 source_kind 过滤 */}
</IngestTab>
```

后端 `/api/kb/accounts` 和 `/api/kb/accounts/:account/articles` 接收 `?source_kind=x` 查询参数；无参时返回全部（兼容旧调用）。

### 组件切分

- `SourceFetchFab.tsx` — 知识库页的入口按钮 + 打开 / 关闭 console 状态
- `SourceFetchConsole.tsx` — 全屏 console 壳（segment + 内容）
- `SourceListPanel.tsx` — 三 tab 共用的"监控列表 + 增删"组件，通过 props 注入每源特有字段
- `SourceFetchLog.tsx` — 流式日志（复用 `IngestProgressView` 视觉样式）
- `useSourcesYaml.ts` — 读写 `sources.yaml` 的 hook
- `useScrape.ts` — 触发 scrape + 订阅 SSE 事件（类似 `useIngestState`）

## Error Handling

- **单源失败不阻塞其他源**：scraper 以每条 handle / site 为错误边界；任一失败打 `scrape_failed` 事件继续下一个
- **cursor 幂等**：只在 `ref_articles` 写入 commit 后才更新 cursor；中途崩溃下次能重试同一批
- **yaml 写入并发**：UI 写前 read-latest + merge + write；并发场景最坏是最后写的人覆盖前面（文档里说明，交给用户意识）
- **twscrape 账号限流**：捕获 `TwitterException`，事件里 `error` 字段标明；用户下次再跑
- **RSS / HTML 抓取超时**：每条 fetch 设 30s 超时；超时算单条失败，继续下一条

## Testing

**单元测试**
- `sources.yaml` 读写的 parse / serialize / merge 行为
- cursor 的读、merge-update、原子写
- frontmatter 生成（各 source_kind 的字段完整性）

**集成测试**
- mock twscrape / RSS feed 响应，驱动 scraper 完成一轮，验证 ref_articles 和磁盘双文件齐备
- `/api/kb/sources` 的 GET/PUT round-trip
- `/api/kb/scrape` SSE stream 事件顺序

**UI 测试（Vitest + jsdom）**
- `SourceFetchConsole` 切 segment 行为
- `SourceListPanel` 的增删操作写对 API
- `IngestTab` segment 切换对 `AccountSidebar` 的过滤

## Migration / Rollout

1. DB migration：加 `source_kind` 列，默认 `wechat`。现有 121 条 run + 1200+ marks 不动
2. `sources.yaml` 首次运行 seed：若文件不存在，基于现有 `ref_articles.account` 列表生成 `wechat` 区段；x / web 用本 spec 附的默认列表
3. 前端改动可 HMR 增量上线；后端 DB migration 和新 routes 要一次重启

## Open Questions

无（brainstorm 阶段已一一对齐）。

## Subprojects

本 spec 落地后会再做：
- **Sub-project 2：X.com scraper** — twscrape 账号池接入 / thread 聚合算法 / 图片媒体处理
- **Sub-project 3：AI 外网 scraper** — RSS parsing / HTML-to-markdown pipeline / 站点特化规则
- **Sub-project 4：调度 & 云部署** — launchd / 云端 cron / 通知（Phase 2）
