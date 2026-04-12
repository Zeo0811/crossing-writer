# 子项目 1：Vault 基座 + 历史数据导入 + Agent 检索 — 设计 Spec

- 日期：2026-04-12
- 所属项目：crossing-writer
- 子项目编号：SP-01
- 状态：draft（等待 review）

---

## 1. 背景

`crossing-writer` 是一个 CLI-first 的本地多 Agent 内容工作台（详见根目录 01-16 号讨论文档）。整体工程拆成多个子项目，本文档只覆盖**第一个子项目**：把用户已有的 60 家同类型公众号历史数据（xlsx metadata + html 原文）结构化入 Obsidian vault，建立 SQLite 索引，让后续的 Agent（Writer/Researcher/Case Planner 等）能稳定检索"同类参考文章"。

后续子项目（CLI 骨架、Web 工作台、Agent Team、事件流、实时导入等）在本文档范围外，将独立出 spec。

## 2. 子项目目标

1. 建立可被 Obsidian GUI 与 Agent 同时消费的本地知识库根目录 `~/CrossingVault/`
2. 一次性导入用户 `/Users/zeoooo/Downloads/60-表格/` + `/Users/zeoooo/Downloads/60-html/` 下全部历史文章（预计 3–6 万篇）
3. 产出可直接被 Agent 调用的检索接口（Node.js 函数 + CLI 镜像命令）
4. 为后续"实时采集（公众号/X/网站）"、"主题打标"、"向量召回"预留扩展点，但首版不实现

**非目标（首版明确不做）：**
- 实时采集 agent
- 向量检索 / Embedding
- Obsidian 插件
- Topic 打标的自动执行（仅提供命令，何时跑由用户决定）
- 图片 OCR / 视频转写

## 3. 使用场景（Agent 层面）

- 场景 A：Writer 起草开头时，查询"量子位过去 3 个月关于 Claude Code 的文章"做风格参考
- 场景 B：Researcher 做赛道扫描，按 `topics=agent` + `date≥2025-01` 返回候选文章列表
- 场景 C：Brief Analyst 判断选题差异化，用 FTS5 全文搜索同主题已有稿件
- 场景 D：长期增量——未来新导入的公众号/X/网站文章走同一 schema，Agent 调用方式不变

## 4. 物理布局

### 4.1 Vault 目录

```
~/CrossingVault/
  .obsidian/                          # Obsidian 首次打开自动生成，不手工维护
  10_refs/                            # 参考文章库（本子项目核心产出）
    智东西/
      2025/
        2025-05-30_600亿AI算力龙头-冲刺港交所.md
        2025-05-30_600亿AI算力龙头-冲刺港交所.html
      2026/
        ...
    量子位/
      ...
  01_brands/                          # 预留：品牌 wiki
  02_products/                        # 预留：产品 wiki
  05_research/                        # 预留：主题研究
  06_cases/                           # 预留：case 库
  07_projects/                        # 预留：项目工作区
  09_assets/                          # 预留：媒体资产
  .index/
    refs.sqlite                       # Agent 检索索引（隐藏目录，Obsidian 默认不扫）
    import.log
```

### 4.2 代码侧配置

`/Users/zeoooo/crossing-writer/config.json`

```json
{
  "vaultPath": "~/CrossingVault",
  "sqlitePath": "~/CrossingVault/.index/refs.sqlite",
  "modelAdapter": {
    "defaultCli": "claude",
    "fallbackCli": "codex"
  }
}
```

Vault **不进 git**。Repo 只存代码与 spec。

### 4.3 文件名消毒规则

原微信标题可能含 `/ \ : * ? " < > |` 以及 emoji。消毒规则：
- 上述 9 个字符统一替换为 `-`
- 连续空白折叠为单个 `-`
- 末尾 `.` 去掉（macOS 忌）
- 超过 120 字节截断，追加 `url` 末 8 位作为去重后缀
- **原标题完整保留在 frontmatter `title` 字段**

## 5. 每篇 note 的结构

### 5.1 Frontmatter

```yaml
---
type: ref_article
source: wechat_mp
account: 智东西                  # 对应 xlsx "公众号"
title: 600亿AI算力龙头，冲刺港交所！
author: 江宇                     # 对应 xlsx "作者"，可空
published_at: 2025-05-30
is_original: true                # 对应 xlsx "原创"（"是"→true）
position: 1                      # 对应 xlsx "位置"
url: http://mp.weixin.qq.com/s?...
cover: https://mmbiz.qpic.cn/...
summary: 云电脑、云手机...        # 对应 xlsx "文章摘要"
word_count: 3240
topics_core: []                  # Phase 2 打标后填
topics_fine: []                  # Phase 2 打标后填
ingest_status: raw               # raw → cleaned → topics_tagged
imported_at: 2026-04-12T14:30:00+08:00
html_path: 2025-05-30_xxx.html   # 同目录相对路径
---

# {正文}

<BeautifulSoup + markdownify 转换后的 markdown>
```

### 5.2 正文抽取规则（HTML → MD）

- 解析器：BeautifulSoup + `markdownify`
- 移除节点：页头（`#js_article_meta` 以上）、"预览时标签..."、"继续滑动看下一个"、二维码块、底部推广卡片、阅读原文链接、微信原生"赞""在看"按钮区
- 保留节点：正文段落、标题（h1-h4）、引用、代码块、列表、图片（`<img>` 的 `data-src` 解析为 src，保留原图 URL 不下载）、微信专有 `<section>` 转换为 `<div>` 后再转 md
- 代码块：`pre code` 原样保留
- 图片：只保留远程 URL，不下载到 assets/（首版不做镜像；未来若微信失效再做）

## 6. SQLite 索引（Agent 消费入口）

### 6.1 主表

```sql
CREATE TABLE ref_articles (
  id               TEXT PRIMARY KEY,          -- hash(url)
  account          TEXT NOT NULL,
  title            TEXT NOT NULL,
  author           TEXT,
  published_at     TEXT NOT NULL,             -- ISO date
  is_original      INTEGER NOT NULL DEFAULT 0,
  position         INTEGER,
  url              TEXT NOT NULL UNIQUE,
  cover            TEXT,
  summary          TEXT,
  word_count       INTEGER,
  md_path          TEXT NOT NULL,             -- vault 相对路径
  html_path        TEXT NOT NULL,
  body_plain       TEXT,                      -- 正文纯文本（去 md 标记），供 FTS5
  body_segmented   TEXT,                      -- jieba 分词后的空格分隔串
  topics_core_json TEXT,                      -- JSON array
  topics_fine_json TEXT,                      -- JSON array
  ingest_status    TEXT NOT NULL DEFAULT 'raw',
  content_hash     TEXT,                      -- sha1(body_plain)，供增量检测
  imported_at      TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX idx_refs_account        ON ref_articles(account);
CREATE INDEX idx_refs_published_at   ON ref_articles(published_at);
CREATE INDEX idx_refs_ingest_status  ON ref_articles(ingest_status);
```

### 6.2 FTS5 虚表

```sql
CREATE VIRTUAL TABLE ref_articles_fts USING fts5(
  title,
  summary,
  body_segmented,            -- 用 jieba 预分词后喂给 simple tokenizer
  content='ref_articles',
  content_rowid='rowid',
  tokenize='simple'
);
```

触发器保持两表同步（insert/update/delete 三个触发器，标准模式）。

### 6.3 错误/遗漏记录

```sql
CREATE TABLE ingest_issues (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account       TEXT,
  xlsx_row      INTEGER,
  html_path     TEXT,
  error_kind    TEXT NOT NULL,   -- MISSING_HTML | PARSE_ERROR | EMPTY_BODY | TITLE_MISMATCH | WRITE_ERROR
  message       TEXT,
  created_at    TEXT NOT NULL
);
```

## 7. Phase 1 导入器（Python）

### 7.1 位置与栈

```
crossing-writer/tools/bulk_import/
  pyproject.toml
  import.py               # 入口：python -m bulk_import.import --config ../../config.json
  extractor.py            # html → md
  matcher.py              # xlsx row ↔ html file
  db.py                   # sqlite 初始化与 upsert
  segmenter.py            # jieba 分词
  __main__.py
```

依赖：`openpyxl`, `beautifulsoup4`, `markdownify`, `jieba`, `tqdm`, `rich`

### 7.2 主流程

1. 读 `config.json` 得 `vaultPath`
2. 初始化 SQLite（若 `refs.sqlite` 不存在则建表）
3. 遍历 `/Users/zeoooo/Downloads/60-表格/*.xlsx`
4. 对每个 xlsx：
   a. 读全部行，按（发布时间 + 标题消毒后）生成 html 文件名预期
   b. 在 `/Users/zeoooo/Downloads/60-html/<公众号>/html/` 下匹配
   c. 对每篇：
      - 若 `url` 已在 SQLite 且 `content_hash` 相同 → SKIP
      - 否则：抽正文 → 分词 → 写 md + 拷 html 到 vault → upsert SQLite
      - 失败则写 `ingest_issues`，继续下一篇
5. 结束打印统计：成功 / 跳过 / 失败 / issues 分类计数

### 7.3 幂等性

- 以 `url` 为唯一键
- `content_hash = sha1(body_plain)` 变化才覆盖 md 文件；否则不写盘
- 重跑同一批应在几分钟内完成（只做 SQLite 查询）

### 7.4 并发

首版**单线程**，靠 `tqdm` 进度条可视化。预估：几万篇 × ~50ms/篇 ≈ 30–50 分钟，一次性跑完可接受。未来增量导入频率低，不需要优化。

### 7.5 标题↔html 匹配兜底

若消毒后文件名找不到对应 html：
- 模糊匹配同日期下所有 html，按标题 Levenshtein 距离 ≤ 3 认定为同一篇
- 仍失败 → 写 `ingest_issues(error_kind=MISSING_HTML)`，跳过（保留 xlsx 元数据不入库，避免无正文的半成品）

## 8. Phase 2 主题打标（延后、独立命令）

### 8.1 命令

```bash
python -m bulk_import.tag \
  --account 智东西 \
  --batch 100 \
  --since 2025-01-01 \
  --only-status raw        # 只打未标过的
```

### 8.2 Prompt 模板（骨架）

给 Claude CLI 的输入：

```
[系统] 你是一个内容分类助手。根据文章标题、摘要、正文前 800 字，输出核心分类和细粒度标签。
核心分类必须从以下 15 个中选 1-3 个：agent, coding, 多模态, 大模型训练,
产品测评, 融资, 政策监管, 开源, 具身智能, 芯片算力, 应用落地, 访谈,
行业观察, 评论观点, 教程
细粒度标签自由生成 2-5 个，用于长尾查询。
只输出 JSON：{"topics_core":[...], "topics_fine":[...]}

[用户]
标题：{title}
摘要：{summary}
正文：{body_excerpt}
```

### 8.3 执行器

- 调 `claude -p "<prompt>" --output-format json`（子进程）
- stdout 做容错 JSON 提取（可能带 markdown fence）
- 写回 SQLite `topics_core_json` / `topics_fine_json`，`ingest_status=topics_tagged`
- 同步改写对应 md 文件的 frontmatter（保持 vault 与索引一致）
- 失败 3 次重试，仍失败则 `ingest_status=tag_failed`，记 `ingest_issues`

### 8.4 用量控制

- `--batch N` 打 N 篇就停
- 默认串行，单篇 ~10 秒（Claude CLI 启动开销）
- 未来可加 `--parallel 4`

## 9. Agent 检索接口（Node.js）

### 9.1 函数签名

`crossing-writer/packages/kb/src/search.ts`

```ts
export interface SearchOptions {
  query?: string;                    // FTS5 全文
  account?: string | string[];
  author?: string;
  dateFrom?: string;                 // ISO
  dateTo?: string;
  topicsCore?: string[];             // OR 匹配
  topicsFine?: string[];
  isOriginal?: boolean;
  limit?: number;                    // 默认 20
  offset?: number;
}

export interface SearchResult {
  id: string;
  mdPath: string;                    // 绝对路径（由 searchRefs 从 SQLite 相对路径 + vaultPath 拼接）
  title: string;
  account: string;
  author: string | null;
  publishedAt: string;
  url: string;
  summary: string | null;
  snippet: string;                   // FTS5 snippet，查询高亮
  topicsCore: string[];
  topicsFine: string[];
  wordCount: number | null;
  score: number;                     // FTS5 bm25，越低越相关
}

export function searchRefs(opts: SearchOptions): Promise<SearchResult[]>;
export function getRefByUrl(url: string): Promise<SearchResult | null>;
export function getRefById(id: string): Promise<SearchResult | null>;
```

### 9.2 SQL 模式

- 有 `query` → join `ref_articles_fts` 用 `MATCH`，按 bm25 排序
- 无 `query` → 直接查主表，按 `published_at DESC`
- `topics_core` / `topics_fine` 用 SQLite JSON1 的 `EXISTS (SELECT 1 FROM json_each(topics_core_json) WHERE value IN (...))`

### 9.3 CLI 镜像

```bash
crossing kb search "claude code" --account 量子位 --since 2025-01-01 --limit 10
```

输出为 JSONL（供管道）或人类可读表格（默认）。

### 9.4 Agent 集成

Agent 通过 `ModelAdapter` 间接调用：
1. Agent prompt 里声明可用 tool `search_refs`
2. ModelAdapter 把 tool call 映射到本地 `searchRefs`（不走 CLI）
3. Agent 拿到 `mdPath` 后用 `read_file` 读正文

本子项目只保证函数接口与 CLI 镜像可用，tool 绑定逻辑放到后续 Agent Team 子项目。

## 10. 验收标准

**功能：**
1. 全量导入完成后，`ref_articles` 行数 ≥ 95% × (xlsx 总行数 − 标题为空行数)
2. `ingest_issues` 总数 < 总行数的 1%
3. Obsidian 打开 `~/CrossingVault` 可正常浏览任一作者任一年的文章，md 格式无明显错乱
4. `crossing kb search "agent 测评"` 在 3 万篇规模下 2 秒内返回

**鲁棒性：**
5. 导入脚本重跑第二次，应全部命中"SKIP"，耗时 < 5 分钟
6. 中途 ctrl-c 后重跑，能从断点继续，无重复/丢失
7. 删除 `.index/refs.sqlite` 后仅跑脚本能从 vault md 文件重建索引（通过 `--rebuild-from-vault` 参数）

**Phase 2：**
8. `tag --batch 50` 可独立运行，不依赖 Phase 1 再跑
9. 打标后 md frontmatter 与 SQLite `topics_*` 字段一致

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 微信 html 结构异常（少数页面） | 抽正文失败 | 记 `ingest_issues.EMPTY_BODY`，人工抽查；不阻塞批量 |
| 标题消毒后冲突（两篇同日同标题消毒后相同） | 文件覆盖 | 文件名追加 `url` 末 8 位 |
| xlsx 有行 html 目录没有对应文件 | 丢元数据 | 记 `MISSING_HTML`，首版选择不入库（保证"有 md 必有正文"） |
| jieba 词典陈旧，新词分不开 | FTS5 召回差 | v1 接受；v2 加自定义词典（如"Claude Code", "MCP"） |
| Obsidian 打开 3 万+文件初始扫描卡顿 | GUI 体验 | 把 `.index/` 加入 Obsidian ignore；目录分层到"年"已控制单层文件数 |
| Claude CLI 订阅 5h 限额 | Phase 2 中断 | `--batch` 小步跑；`ingest_status` 记录进度可续 |

## 12. 未来扩展点（本子项目不实现，但 schema 预留）

- `ref_articles.source` 字段已支持 `wechat_mp` 以外的值（`x_post` / `blog` / `paper`）
- `ref_articles.content_hash` 可用于未来"同文多源去重"
- `topics_fine` 开放 vocab 未来可跑一次"同义词合并"产出 `topics_canonical` 列
- 向量检索：未来可加 `ref_vectors` 表（rowid 对齐），不动现有逻辑
- 实时导入 agent 写同一 SQLite，`source` 字段区分；md 落到 `11_refs_realtime/` 或合并进 `10_refs/`（待定）

## 13. 实施顺序（交给 writing-plans 细化）

1. 建 `config.json` + vault 目录骨架
2. Python 包骨架 + `db.py` 建表
3. `extractor.py` 写并用 5 篇真实样本测试
4. `matcher.py` + 消毒规则
5. `import.py` 主循环串起来，先跑 1 个小作者（如"AGI Hunt"）验证
6. 全量跑 60 家
7. Node.js `packages/kb/search.ts` + FTS5 查询
8. `crossing kb search` CLI 命令
9. Phase 2 `tag.py`（本子项目尾声，可延后）

## 14. 验收与交付

- 代码位于 `crossing-writer/tools/bulk_import/` + `crossing-writer/packages/kb/`
- Vault 位于 `~/CrossingVault/`（部署时生成，不提交 git）
- 导入日志 `~/CrossingVault/.index/import.log`
- 本 spec 通过后，调用 `writing-plans` skill 产出分步实施计划
