# Style Corpus + Writing Upgrade — Design

Status: draft
Date: 2026-04-18
Owner: zeoooo

## Goal

让 writer agent 写出来的内容**更好更丰富**。三个互相耦合的改动：

1. 工具调用强度提升：每个 writer role 有**硬下限** + prompt 铁律触发自动判断
2. 新增 `search_style` 工具：写稿时能查原文 + 蒸馏 snippets 找"写法"
3. 蒸馏流程支持**手选文章**，并且支持同一账号产出多个"风格版本"

核心统一抽象：`styleCorpus` —— 一个命名的"文章集合"，一次定义三处用（蒸馏 / prompt / 查询）。

## 非目标

- 不改 writer orchestrator 的整体状态机（writing_ready / writing_editing / writing_done）
- 不改知识库入库（wiki ingest）流程
- 不引入新的 cli / 模型类型
- 不自动筛选文章（手选或全账号，不做自动推荐）

## 现状快照

- **写作工具**：`search_wiki` + `search_raw`，agent 可用但不强制；round cap 5；`packages/agents/src/writer-tool-runner.ts:126`
- **风格面板**：每个 `(account, role)` 有版本化 panel，写作时通过 `styleBinding` 读取 `typeSection` 注入 prompt；`packages/web-server/src/services/style-binding-resolver.ts`
- **蒸馏**：`packages/kb/src/style-distiller/orchestrator.ts` 4 步（quant → structure → snippets → composer），按日期范围分层采样 ~200 篇，不支持指定文章
- **入库**：`packages/web-ui/src/components/wiki/IngestTab.tsx` 已有成熟的账号/热力图/搜索/全选文章选择器

## 设计

### 1. `styleCorpus` 统一抽象

#### 1.1 存储

**Corpus 定义**（vault 里，markdown + frontmatter，用户可手改）：

```
vault/08_experts/style-corpus/
├── 十字路口-001.md
├── 十字路口-深度.md
└── 量子位-默认.md
```

Frontmatter 格式：

```yaml
---
id: 十字路口-001
description: Koji 深度访谈系列
created_at: 2026-04-18T10:30:00Z
articles:
  - account: 十字路口Crossing
    ids: [abc123, def456, ghi789]   # 精选文章 id
  - account: 量子位
    all: true                        # 整账号
---

<可选的人类笔记正文>
```

`articles` 条目支持两种形态：
- `ids: [...]` — 精选，只收这些 `article_id`
- `all: true` — 收该账号全部 ref_articles

混合可用（一个 corpus 里既有精选 + 整账号）。

#### 1.2 蒸馏产出路径

```
vault/08_experts/style-panel/
└── 十字路口-001/              ← 目录名 = corpus id（不再是 account）
    ├── opening-v1.md
    ├── practice-v1.md
    └── closing-v1.md
```

**每个 panel v 号独立递增**。同一 corpus 重新蒸馏生成 v+1，旧版本保留（`status: deleted` or `archived`）。

#### 1.3 Sqlite 索引（新表）

为了 `search_style` 工具能高效查 corpus 内文章，加一张索引表：

```sql
CREATE TABLE style_corpus_articles (
  corpus_id   TEXT NOT NULL,
  account     TEXT NOT NULL,
  article_id  TEXT NOT NULL,
  PRIMARY KEY (corpus_id, account, article_id)
);
CREATE INDEX idx_sca_corpus ON style_corpus_articles(corpus_id);
```

启动时扫 `style-corpus/*.md` 重建这张表（轻量操作，~10ms 对 100 corpus）。

### 2. Agent 配置

#### 2.1 `styleBinding` 升级

旧：`{ account: "十字路口", role: "opening" }`  
新：`{ corpus: "十字路口-001", role: "opening" }`

`resolver` 逻辑：用 `(corpus, role)` 去 `style-panel/<corpus>/<role>-v*.md` 找最新 active 版本。

#### 2.2 新字段 `styleReferences`

```yaml
writer.opening:
  styleBinding: { corpus: 十字路口-001, role: opening }
  styleReferences: [十字路口-001, 量子位-默认]    # search_style 工具的白名单
```

Agent 的 `search_style` 只能查 `styleReferences` 列表里的 corpus。不在列表里的 corpus 查不到（即使 corpus 存在）。

### 3. 新工具 `search_style`

#### 3.1 语法（tool protocol）

```
search_style "<query>" [--corpus=<id>] [--source=raw|snippets|all] [--limit=5]
```

- 默认 `--source=all`：先查蒸馏 snippets（精选），再查 corpus 文章 raw body，合并结果
- `--corpus=<id>` 只查一个（必须在 `styleReferences` 白名单内），不带则查全部白名单合集
- `--limit` 默认 5，最多 10

#### 3.2 返回格式

```json
[
  {
    "source": "snippets" | "raw",
    "corpus": "十字路口-001",
    "account": "十字路口Crossing",
    "article_id": "abc123",
    "title": "...",
    "snippet": "<匹配段落，~200-400 字>",
    "score": 0.82
  }
]
```

返回的结构化 JSON，agent prompt 里会 format 成 markdown。

#### 3.3 后端实现

- `raw` source: FTS5 查 `ref_articles_fts`，按 corpus_id 过滤 `(account, article_id) IN corpus.articles`
- `snippets` source: 启动时把所有 panel 的 `## snippets` 小节扫进内存索引（对每个 corpus 的每个 role，存 snippets 列表），关键词 LIKE 匹配
- 合并：snippets 优先（score 加 0.2 boost），raw 次之
- 20KB 结果截断沿用（`MAX_FORMATTED`）

### 4. 工具调用强度提升

#### 4.1 硬下限

| Role | `search_wiki` | `search_raw` | `search_style` | 合计 |
|---|---|---|---|---|
| opening | ≥1 | ≥1 | ≥1 | 3 |
| practice | ≥1 | ≥2 | ≥1 | 4 |
| closing | ≥1 | ≥1 | ≥1 | 3 |

- orchestrator 在 writer-tool-runner 里记录实际调用次数
- 不达标时不放过：回灌 user message「你还没调 X 次 Y 工具，请先补齐再继续写」

#### 4.2 Round cap

5 → **12**，给自主判断留余地。超 12 还没结束则强制收场、报错。

#### 4.3 Prompt 铁律（写进 `_tool-protocol.md` 或 writer system prompt）

```
触发规则（不遵守会被打回）：
1. 写具体数据/专名/人名/产品名 → 必须先 search_wiki 确认
2. 写引用/对话/亲历描述 → 必须先 search_raw 核原文
3. 过渡/金句/段落收尾卡壳 → 先 search_style 找范例
4. 每写 2-3 段后，反思一次"没查就写"之处，补查
```

### 5. UI 改动

#### 5.1 风格库页面（StylePanelsPage）

- 列表从「账号 grid」改成「Corpus grid」
- 每张 corpus 卡片显示：id、description、文章来源摘要（"十字路口 3 篇 + 量子位 整账号"）、最新蒸馏 version、更新时间
- 顶部「新建 Corpus」按钮

#### 5.2 新建 Corpus 流程

1. 点「新建 Corpus」→ modal 弹出
2. Step 1：填 id、description
3. Step 2：**嵌入 `IngestTab` 的文章选择器**（复用组件）：
   - 账号网格
   - 选中账号 → 出热力图 + 搜索 + 全选
   - "全选 N 篇" / "精选 N 篇" 两种模式
   - 可多账号叠加
4. Step 3：保存 corpus → 生成 `style-corpus/<id>.md`
5. Step 4：提示"是否立即蒸馏"→ 是就跑 4 步蒸馏

#### 5.3 蒸馏触发

在 corpus 卡片上有「蒸馏」按钮，点击开始 4 步流程，进度 SSE 推送到现有 `ProgressView`。

### 6. 迁移（兼容老数据）

启动时一次性脚本（`ensureCorpusMigration`）：

1. 扫 `style-panel/<account>/` 找所有老 panel（目录名不是合法 corpus id 的）
2. 对每个 account 创建 `<account>-默认` corpus：
   ```yaml
   id: <account>-默认
   description: 从 v1.0 迁移（整账号自动蒸馏）
   articles:
     - account: <account>
       all: true
   ```
3. 搬 panel 文件：`style-panel/<account>/` → `style-panel/<account>-默认/`
4. 扫 `config.json` 的 `agents.*.styleBinding`：把 `{ account, role }` 升级成 `{ corpus: "<account>-默认", role }`
5. 新增字段 `styleReferences: ["<account>-默认"]`（默认只含自己绑定的那个）
6. 标记 `_migration_v2: true` 防重复迁移

### 7. 关键文件改动清单

**新增：**
- `packages/kb/src/style-corpus/store.ts` — corpus CRUD (读 md + sqlite 索引)
- `packages/kb/src/style-corpus/migration.ts` — 一次性迁移
- `packages/kb/src/skills/search-style.ts` — 新工具实现
- `packages/web-server/src/routes/kb-style-corpus.ts` — corpus REST 接口
- `packages/web-ui/src/pages/StyleCorpusPage.tsx` — 新页面（或改造 StylePanelsPage）
- `packages/web-ui/src/components/style-corpus/CorpusBuilder.tsx` — 嵌入 IngestTab 选择器的 modal

**修改：**
- `packages/kb/src/style-distiller/orchestrator.ts` — 接受 corpus 作为输入（替代账号+日期范围）
- `packages/web-server/src/services/style-binding-resolver.ts` — 解析 `{corpus, role}`
- `packages/agents/src/writer-tool-runner.ts` — 接受 `styleReferences`，实现硬下限 gate，round cap 5→12
- `packages/agents/src/prompts/_tool-protocol.md` — 新工具语法 + 铁律
- `packages/kb/src/skills/dispatcher.ts` — 注册 `search_style`
- `packages/web-server/src/routes/writer.ts` — 透传 `styleReferences`
- `packages/web-server/src/config.ts` — `styleBinding` 形状升级 + 迁移

### 8. 测试策略

- **单元**：corpus store CRUD / migration / search_style 查询 / tool-runner 下限 gate
- **集成**：
  - 从头建 corpus → 蒸馏 → 写稿，验证 styleBinding 解析正确
  - 迁移老数据，验证老配置仍能写稿
  - agent 故意不调工具，验证被打回
- **e2e**（可选）：走一篇完整写稿流程，检查三工具都被调用、输出里有 tool log

## 未决 / 可选 todo

- **corpus 文件热重载**：目前设计是启动扫一次。如果用户手改 corpus md 怎么办？短期：重启生效；长期：fs.watch。
- **snippets 索引什么时候重建**：同上，panel 更新后是否自动刷新内存索引？简单方案：每次 `search_style` 命中 snippets 分支前，检查 panel mtime，有变更就重扫该 corpus 的 snippets。
- **search_style 排序**：第一版用 FTS rank + snippets boost。后续可以上 embedding 相似度。
- **corpus 可否跨账号同时精选和整账号**：允许（见 1.1），但 UI 要能清楚显示"精选 5 篇 + 整账号"。

## 决策链 review

| # | 决策 | 选项 | 决定 |
|---|---|---|---|
| Q1 | search_style 查什么源 | raw / snippets / 两者 | 两者 + wiki 分工（wiki 管事实不管风格） |
| Q2 | 账号白名单配置 | per-agent / per-project / 预置集合 / 混合 | 预置集合 + agent 引用名字 |
| Q3 | 集合装什么 | 账号 / 文章 / 两种 | 两种都支持 |
| Q4 | 多集合调用方式 | 手选 / 自动合 / 可选指定 | 可选指定，默认合并 |
| Q5 | 硬下限数字 | — | opening 3 / practice 4 / closing 3 |
| Q6 | 手选模式共存 | 互斥 / override / 自动跳 quant | 互斥（手选 = 跳 quant，纯 struct+snippets+composer） |
| Q7 | edition vs collection | 分 / 合 | 合（统一为 styleCorpus） |
