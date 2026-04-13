# 子项目 2：Mission 工作台（Web shell + Brief + 专家团 Mission）— 设计 Spec

- 日期：2026-04-13
- 所属项目：crossing-writer
- 子项目编号：SP-02
- 状态：draft（等待 review）
- 前置依赖：SP-01（Vault + `refs.sqlite` + `packages/kb`）已合并到 main

---

## 1. 背景

SP-01 把 5 万篇参考文章导入了 `~/CrossingVault/` 并建了 FTS5 索引。现在需要把这个底层资源接入实际的内容生产流程。

**整个项目的 7 阶段流水线**（参考根目录早期讨论文档，调整过顺序）：

```
① Brief 输入 (+ Raw 检索)
      ↓
② 专家团评估 + refs 交叉查阅 → 3 个候选 Mission
      ↓ [人工选 Mission]
③ 产品概览（用户上传截图/链接）
      ↓
④ Case 规划（Agent 建议）
      ↓ [人工选 Case]
⑤ 真人上手实测 → 上传 Evidence
      ↓
⑥ 写作（标题 / 开头 / 实测正文 / 结尾 四个子 Agent）
      ↓
⑦ Review（专家团审稿）
```

**SP-02 范围：只做 ①-②**。Brief 进来，Mission 定出，到此收工。后续阶段作为 SP-03、SP-04 独立子项目。

为什么这样切：
- 基础设施一次建好（Web 服务、左右分屏、项目状态机、ModelAdapter、Agent 角色抽象、SSE 推送、refs 检索接入）—— 所有后续子项目都复用
- 产出是可独立使用的工具："丢一份 brief，我结合 5 万篇行业文章给你 3 个主命题" 本身就值钱
- 先跑 3-5 次真约稿再放大，避免一次性把 7 阶段 UI 全设计完然后返工
- 2-3 周可以 ship

## 2. 非目标（SP-02 明确不做）

- ❌ Case 规划 / Evidence 上传 / Writer / Review（③-⑦，放 SP-03+）
- ❌ 自动蒸馏专家卡（手工 + 预制即可，自动化放独立子项目）
- ❌ 真正的 Markdown 编辑器（Mission 阶段没有正文，SP-03 Writer 阶段再做）
- ❌ 发布（微信公众号 API，复用 `end_to_end-layout`，放 SP-04+）
- ❌ 产品截图上传（Case 阶段才需要）
- ❌ LLM token-level 流式输出（agent 状态级流就够了）
- ❌ 客户端 cancel 正在跑的 agent（刷新放弃即可）
- ❌ Playwright 爬取 JS 重站点（用简单 fetch，抓不全提示用户手动补）
- ❌ SQLite 项目索引表（文件扫 `07_projects/*/project.json` 即可）
- ❌ 主题打标的批量化（SP-01 Phase 2 已在后台慢慢跑）

## 3. 用户故事

### 3.1 主流程

1. 打开本地 web（`localhost:3000`），看到项目列表
2. 点"新建项目"，填项目名
3. 上传甲方 Brief（docx/pdf/md/txt 任一），选填产品名+官网 URL
4. 点"开始"
5. **Brief Analyst** 解析 Brief，左侧显示结构化摘要（命题关键词/必打点/禁区/语气）
6. 弹出**专家选择器**，默认预选 2 位（最常用的），可改到 1-N 位
7. 点"开跑"
8. 右侧时间线实时显示：
   - Round 1：选中的专家独立评估（互相看不见）
   - Coordinator 合成 3 个候选 Mission
   - Round 2：专家打分 + 指风险
9. 左侧显示 3 个 Mission 候选卡片（排名好的顺序）
10. 用户选一个（或编辑后选），点"批准"
11. 左侧定型为 `selected Mission`。SP-02 完成。

### 3.2 副故事

- 回顾项目：打开任一项目，恢复到上次的状态
- 切项目：项目列表快速切换
- 重跑 Mission 阶段：同一个 Brief 改选其他专家再跑一遍（历史保留）

## 4. 技术栈

### 4.1 整体

沿用 SP-01 的 monorepo 结构，扩展：

```
crossing-writer/
  packages/
    kb/                ← SP-01 已有：refs 检索 + CLI
    web-server/        ← 新增：Fastify 后端 + agent 编排 + SSE
    web-ui/            ← 新增：Vite + React 前端
    agents/            ← 新增：Agent 角色抽象 + ModelAdapter 扩展
  tools/
    bulk_import/       ← SP-01 已有：Python 批量导入
```

### 4.2 各包依赖

| 包 | 技术选型 |
|---|---|
| `packages/web-server` | Node 20+, Fastify 5, better-sqlite3（读 `refs.sqlite`）, mammoth（docx→md）, pdf-parse（pdf→md）, @mozilla/readability（URL 抓取）, vitest |
| `packages/web-ui` | Vite 5, React 19, TanStack Query, react-markdown, Tailwind 4, vitest |
| `packages/agents` | Node 20+, TypeScript, 复用 SP-01 的 claude_cli subprocess 模式但扩展为 TS，支持 per-agent model config |

### 4.3 启动命令

`pnpm dev` 起 web-server + web-ui 两个进程，浏览器打开 `localhost:3000`（Vite dev 默认端口，代理到 web-server 的 `:3001`）。

## 5. 物理布局

### 5.1 Vault 新增目录

```
~/CrossingVault/
  08_experts/                           ← 新增
    topic-panel/
      SKILL.md                          ← 入口规则（从 ai-kepu-panel 拷贝）
      experts/
        数字生命卡兹克_kb.md             ← 10 张已蒸馏卡（从 ai-kepu-panel 拷贝）
        苍何_kb.md
        … (10 张)
      index.yaml                        ← 激活列表 + 元数据
    style-panel/
      十字路口_kb.md                     ← 已落盘（SP-02 brainstorm 期间手搓 v1）
      index.yaml
  07_projects/<project-name>/           ← 每个项目一个目录（结构见 §6.1）
```

### 5.2 Repo 新增

```
crossing-writer/
  packages/web-server/
    src/
      server.ts                 ← Fastify 入口
      routes/
        projects.ts             ← 项目 CRUD
        brief.ts                ← Brief 上传/解析
        mission.ts              ← Mission 两轮评审
        stream.ts               ← SSE 推送
        experts.ts              ← 专家列表/选择
      services/
        brief-analyzer.ts       ← 调 Brief Analyst agent
        expert-coordinator.ts   ← Mission 两轮编排
        url-fetcher.ts          ← URL → readability → md
        file-extractor.ts       ← docx/pdf → md
      state/
        project-state-machine.ts
        event-log.ts            ← events.jsonl 写入器
    tests/
    package.json
  
  packages/web-ui/
    src/
      App.tsx
      pages/
        ProjectList.tsx
        ProjectWorkbench.tsx    ← 主页面（左右分屏）
      components/
        LeftPane/
          BriefSummaryCard.tsx
          MissionCandidateCard.tsx
          SelectedMissionView.tsx
        RightPane/
          BriefIntakeForm.tsx
          ExpertSelector.tsx
          AgentTimeline.tsx     ← SSE 订阅，实时更新
      hooks/
        useProjectStream.ts     ← SSE EventSource 包装
      api/
        client.ts
    tests/
    index.html
    package.json
  
  packages/agents/
    src/
      index.ts
      model-adapter.ts          ← 扩展 SP-01 claude_cli，加 per-agent config
      agent-base.ts             ← Agent 基类：name + systemPrompt + run()
      roles/
        brief-analyst.ts
        topic-expert.ts         ← 参数化：接受一个 KB 文件路径作为 persona
        style-expert.ts         ← 参数化：接受一个 style KB 文件
        coordinator.ts
      prompts/
        brief-analyst.md
        coordinator-round1.md
        coordinator-round2.md
    tests/
    package.json
```

## 6. 数据模型

### 6.1 项目目录结构

```
~/CrossingVault/07_projects/<project-id>/
  project.json
  brief/
    raw/brief.docx              ← 用户原始上传，保留
    brief.md                    ← 转换后的 md（统一格式）
    brief-summary.md            ← Brief Analyst 的结构化输出
  context/
    product.md                  ← 产品名/URL/备注（用户填）
    product-fetched.md          ← URL fetch 的自动抓取内容
    refs-pack.md                ← Coordinator 预取的 refs 摘要
  mission/
    round1/
      <expert-name>.md          ← 每位专家独立意见（互相不可见）
    candidates.md               ← Coordinator 合成的 3 个候选
    round2/
      <expert-name>.md          ← 每位专家对 3 个候选的评分
    selected.md                 ← 人工最终选定（SP-02 产出）
  events.jsonl                  ← 状态流水（append-only）
```

### 6.2 project.json

```json
{
  "id": "metanovas-review",
  "name": "MetaNovas 实测",
  "status": "awaiting_mission_pick",
  "stage": "mission",
  "experts_selected": ["赛博禅心", "数字生命卡兹克"],
  "brief_path": "brief/brief.md",
  "selected_mission_path": null,
  "created_at": "2026-04-13T12:00:00+08:00",
  "updated_at": "2026-04-13T12:34:56+08:00"
}
```

### 6.3 brief-summary.md frontmatter

```yaml
---
type: brief_summary
project_id: metanovas-review
client: <甲方名>
brand: MetaNovas
product: <产品名>
article_type: product-review
goal: <一句话传播目标>
audience: <目标读者>
key_messages: ["...", "..."]
value_props: ["...", "..."]
forbidden_claims: ["...", "..."]
tone: <品牌语气>
deadline: <YYYY-MM-DD or null>
gap_notes: <信息缺口说明>
---
# Brief 摘要
<Brief Analyst 自然语言总结 ~300 字>
```

### 6.4 mission/candidates.md

```yaml
---
type: mission_candidates
project_id: metanovas-review
coordinator_version: v1
generated_at: ...
---

# 候选 1

**主命题**：...
**次命题**：...
**必打点**：...
**避免角度**：...
**建议文章类型**：...
**支撑论据**：...

# 候选 2
...

# 候选 3
...
```

### 6.5 mission/selected.md（SP-02 最终产出）

```yaml
---
type: mission
project_id: metanovas-review
selected_from: candidates.md#候选 2
approved_by: human
approved_at: ...
---

# Mission

**主命题**：...
**次命题**：...
**必打点**：...
**避免角度**：...
**建议文章类型**：...
```

SP-03 Case Planner 读这个 md 作为输入即可。

### 6.6 08_experts/*/index.yaml

```yaml
# topic-panel/index.yaml
experts:
  - name: 赛博禅心
    file: experts/赛博禅心_kb.md
    active: true
    default_preselect: true     # 默认预选
    specialty: 深度分析，跨领域映射
  - name: 数字生命卡兹克
    file: experts/数字生命卡兹克_kb.md
    active: true
    default_preselect: true
    specialty: 游戏玩家审美 + Prompt 方法论
  - name: 苍何
    file: experts/苍何_kb.md
    active: true
    default_preselect: false
    specialty: 保姆级教程
  # ... 10 位
```

默认预选 `default_preselect: true` 的那些（初版 2 位，用户在 UI 上改过的选择我们记录偏好，未来按频率排序）。

## 7. 专家团架构

### 7.1 三层专家团

| Panel | 用途 | 触发阶段 | 数量 |
|---|---|---|---|
| topic-panel | 选题评审 | SP-02 Mission | 10（已蒸馏） |
| style-panel | 文风保持 | SP-03 Writer | 1（十字路口 v1 已建） |
| review-panel | 终审 | SP-04 Review | 0（SP-04 再建） |

**SP-02 只激活 topic-panel**。style-panel 的 md 已在 vault 里存着备用。

### 7.2 topic-panel 来源

直接从 `/Users/zeoooo/Downloads/ai-kepu-panel/` 拷贝到 vault：
- `SKILL.md`（入口规则）→ `~/CrossingVault/08_experts/topic-panel/SKILL.md`
- `expert_knowledge/*.md`（10 位 KB）→ `~/CrossingVault/08_experts/topic-panel/experts/*.md`

拷贝，不链接（原件保留，允许后续独立蒸馏流程替换这些文件）。

### 7.3 Agent 调用方式

每位专家的 system prompt = 对应 `*_kb.md` 文件全文 + 通用任务说明。调 LLM 子进程的时候，专家的"身份"就是这个 KB 文件的内容。

## 8. Mission 两轮评审流程（核心）

### 8.1 流程图

```
Brief 上传
    │
    ▼
Brief Analyst: Brief → brief-summary.md (frontmatter + 摘要)
    │
    ▼
等待用户：选哪些专家（默认预选 2 位）
    │
    ▼
Coordinator: 检索 refs.sqlite 生成 refs-pack.md（shared context pack）
    │
    ▼
【Round 1】并行：每位选中专家独立读 brief-summary + refs-pack，输出：
  - 评分 1-10
  - 3 条角度建议
  - 每个角度的选题雏形
  各专家互相不可见（防止从众）
    │
    ▼
Coordinator: 读所有专家 round1 意见 + brief-summary，合成 3 个候选 Mission → candidates.md
    │
    ▼
【Round 2】并行：每位专家看 candidates.md 的 3 个候选，输出：
  - 每个候选的评分 1-10
  - 最致命的一个风险
    │
    ▼
Coordinator: 聚合 round2 评分排序 → 更新 candidates.md 的显示顺序
    │
    ▼
等待用户：从 3 个候选里选一个（或编辑后选）
    │
    ▼
写入 mission/selected.md，status → mission_approved
    │
    ▼
SP-02 完成
```

### 8.2 Round 1 专家输出 schema（markdown + frontmatter）

```yaml
---
type: expert_round1
expert: 赛博禅心
project_id: metanovas-review
---
# 评分：8/10
# 角度 1：<短描述>
雏形命题：<一句话>
理由：...
# 角度 2
...
# 角度 3
...
```

### 8.3 Coordinator Round 1 Prompt（骨架）

```
你是多专家评审的 Coordinator。下面是：
- 甲方 brief 摘要
- 3 位专家对这个 brief 的独立评估（各自从自己的选题角度）

你的任务：合成 3 个候选 Mission（不是照搬某位专家的意见，而是吸收各家长处、避各家短板）。
每个 Mission 包含：primary_claim / secondary_claims / must_cover / avoid_angles / 建议文章类型。

输出 markdown（schema 见下）...
```

### 8.4 Round 2 专家输出

```yaml
---
type: expert_round2
expert: 赛博禅心
---
# 候选 1：评分 7/10
风险：<最致命的一个>
# 候选 2：评分 9/10
风险：...
# 候选 3：评分 6/10
风险：...
```

### 8.5 专家互相不可见实现

- Round 1 的每位专家的 system prompt 里不包含其他专家的输出
- 每位专家的 agent 调用是**独立子进程**，进程之间无共享状态
- Coordinator 是唯一能看所有输出的角色

## 9. refs 检索接入方式

### 9.1 默认：B 策略（shared context pack）

Coordinator 在 Round 1 前做一次检索：
- 用 Brief 摘要里的 `brand`、`product`、`key_messages` 等关键词组合成 3-5 个 FTS5 查询
- 各查 Top 10，合并去重取 Top 30
- 生成 `refs-pack.md`：每条一行（标题 + 账号 + 日期 + 摘要 + mdPath）
- 所有专家共享这个 pack

### 9.2 逃生舱：专家可按需追加查询

每位专家 prompt 里注明：

> "参考材料见 `refs-pack.md`。如不够，你可以调用以下工具：
> - `search_refs(query, account?, dateFrom?, dateTo?)` - 按条件再查
> - `get_ref_by_url(url)` - 按 URL 取某篇全文
> 如果用了工具，请在输出里说明为什么需要追加查询。"

**实现方式**：专家 Agent 通过 bash 调本地 CLI `crossing-kb search`（SP-01 已建好的命令）。专家 Agent 的 prompt 里允许它输出 shell 调用，agents 包的 runner 识别到 `crossing-kb` 调用后执行并把结果回塞进 Agent 的下一轮推理。这个模式不额外引入 MCP/JSON-RPC，最小代价接通现有 CLI。

## 10. per-agent 模型配置

### 10.1 `config.json` 扩展

```json
{
  "vaultPath": "~/CrossingVault",
  "sqlitePath": "~/CrossingVault/.index/refs.sqlite",
  "modelAdapter": {
    "defaultCli": "codex",
    "fallbackCli": "claude"
  },
  "agents": {
    "brief_analyst":          { "cli": "claude", "model": "sonnet" },
    "topic_expert.赛博禅心":     { "cli": "claude", "model": "opus" },
    "topic_expert.数字生命卡兹克": { "cli": "codex" },
    "topic_expert.default":   { "cli": "codex" },
    "coordinator":            { "cli": "claude", "model": "opus" }
  }
}
```

查找顺序：
1. 精确 key 匹配（`topic_expert.<name>`）
2. 角色 default（`topic_expert.default`）
3. 全局 `modelAdapter.defaultCli`

### 10.2 `packages/agents` ModelAdapter 接口

```ts
interface AgentInvokeOptions {
  agentKey: string;    // 如 "topic_expert.赛博禅心"
  systemPrompt: string;
  userMessage: string;
  timeout?: number;
}

interface AgentResult {
  text: string;
  usage?: { input: number; output: number };
  meta?: { cli: string; model?: string; durationMs: number };
}

function invokeAgent(opts: AgentInvokeOptions): Promise<AgentResult>;
```

底层沿用 SP-01 `claude_cli.py` 的 subprocess 模式，但在 TS 里重实现（因为前后端都要用 TS，且不想进一步增加 Python 边界）。

## 11. UI 设计

### 11.1 主页面布局

```
┌────────────────────────────────────────────────────────┐
│  [顶栏] 项目名 · 当前状态 · ← 项目列表               │
├──────────────────────────┬─────────────────────────────┤
│                          │                             │
│                          │   【右侧：工作区 + 时间线】 │
│   【左侧：成稿草稿区】   │                             │
│                          │   - Brief 上传表单          │
│   - Brief 摘要卡片       │   - 专家选择器              │
│   - 3 个 Mission 候选    │   - Agent 实时时间线        │
│   - 选定的 Mission       │     (SSE 订阅)              │
│   - 事件流（可展开）     │   - 人工操作按钮            │
│                          │                             │
│                          │                             │
└──────────────────────────┴─────────────────────────────┘
```

### 11.2 左侧组件

- `BriefSummaryCard`：显示 brief-summary.md 的 frontmatter（品牌/产品/目标/必打点/禁区）
- `MissionCandidateCard`：3 个候选，每个有"采用/编辑/打回"按钮
- `SelectedMissionView`：选定后显示最终 Mission，以 `react-markdown` 渲染

### 11.3 右侧组件

- `BriefIntakeForm`：项目初建时显示
- `ExpertSelector`：Brief 解析完后显示，checkbox 列表，默认预选基于 `index.yaml`
- `AgentTimeline`：SSE 事件流，显示每个 agent 的 started/completed/failed 节点

### 11.4 实现边界

**SP-02 不做的 UI 复杂度**：
- ❌ 富文本编辑器（延后 SP-03）
- ❌ 拖拽 / 协作 / 版本对比
- ❌ 暗色模式 / 国际化
- ❌ 移动端适配

按 `DESIGN.md` 的绿色主题来（`#407600` 主色，参考 end_to_end-layout 的设计系统）。

## 12. 状态机

```
created
  ↓ (用户上传 brief)
brief_uploaded
  ↓ (Brief Analyst 开跑)
brief_analyzing
  ↓ (Brief Analyst 完成)
awaiting_expert_selection
  ↓ (用户选了专家，点开跑)
round1_running
  ↓ (所有专家 round1 完成)
synthesizing
  ↓ (Coordinator 合成 candidates.md)
round2_scoring
  ↓ (所有专家 round2 完成)
awaiting_mission_pick
  ↓ (用户选定)
mission_approved   ← SP-02 完成

+ failed 分支：任意阶段的 agent 失败都进 `<stage>_failed`，可重跑
```

每个状态跃迁追加一条 `events.jsonl`：

```jsonl
{"ts":"2026-04-13T12:05:23+08:00","type":"state_changed","from":"brief_uploaded","to":"brief_analyzing"}
```

## 13. SSE 事件流

`GET /api/projects/:id/stream` 返回 `text/event-stream`。

**事件类型**（data 为 JSON）：

| event | data schema | 何时触发 |
|---|---|---|
| `state_changed` | `{from, to}` | 项目状态跃迁 |
| `agent.started` | `{agent, stage}` | 某 agent 开始 |
| `agent.completed` | `{agent, stage, output_path?}` | 某 agent 完成 |
| `agent.failed` | `{agent, stage, error}` | 某 agent 失败 |
| `expert.round1_progress` | `{expert, percent}` | 可选，Round 1 内部进度 |
| `expert.round2_progress` | `{expert, percent}` | 可选，Round 2 内部进度 |
| `coordinator.synthesizing` | `{}` | Coordinator 合成中 |
| `coordinator.candidates_ready` | `{output_path}` | 3 候选生成 |

**重连策略**：浏览器自带 SSE 重连。服务端带 `id:` 字段，对应 `events.jsonl` 的行号。重连时读 `Last-Event-ID` header 从该行之后重播。

## 14. API 设计

### 14.1 项目

- `GET /api/projects` - 列项目（扫 `07_projects/*/project.json`）
- `POST /api/projects` - 新建项目 (body: `{name}`)
- `GET /api/projects/:id` - 项目详情 + 当前状态
- `PATCH /api/projects/:id/status` - 强制改状态（debug 用）

### 14.2 Brief

- `POST /api/projects/:id/brief` - 上传 Brief
  - multipart/form-data: `{file?, text?, productName?, productUrl?, notes?}`
  - 内部：`file-extractor` 转 md → 写 `brief/raw/` + `brief/brief.md` → 触发 Brief Analyst
- `GET /api/projects/:id/brief-summary` - 返回 `brief-summary.md`

### 14.3 Mission

- `GET /api/projects/:id/experts` - 列可选专家 + default_preselect
- `POST /api/projects/:id/mission/start` - 开跑两轮评审
  - body: `{experts: [name1, name2, ...]}`
- `GET /api/projects/:id/mission/candidates` - 返回 `candidates.md`
- `POST /api/projects/:id/mission/select` - 选定
  - body: `{candidateIndex: 1, edits?: "..."}`

### 14.4 事件流

- `GET /api/projects/:id/stream` - SSE
- `GET /api/projects/:id/events?offset=0&limit=100` - 分页查历史事件

### 14.5 URL fetching

- `POST /api/util/fetch-url` - body: `{url}`
  - 内部：`fetch` + `@mozilla/readability` 抽正文 → 返回 md

## 15. 验收标准

### 15.1 功能

1. 新建项目 + 上传 docx Brief，5 秒内显示 brief-summary
2. 专家选择器显示 10 位，默认勾 2 位，改选 3-5 位能生效
3. Round 1 所有选中专家并行跑（不串行），全部完成后再 synthesizing
4. `candidates.md` 产出 3 个候选，格式符合 §6.4 schema
5. Round 2 产出后 `candidates.md` 按综合评分排序
6. 用户选定后 `mission/selected.md` 正确写入，状态变 `mission_approved`
7. 整个流程对 1 个中等复杂度 Brief（如 MetaNovas）从上传到 Mission 定稿 **≤ 10 分钟**
8. 刷新浏览器恢复到正确状态（不丢数据）

### 15.2 鲁棒性

9. 任一专家 agent 失败，状态变 `round1_failed`，其他专家结果保留，可重跑失败的
10. Coordinator 失败可重跑，读取已有的 round1 文件
11. URL fetching 失败（超时/404）给出明确错误提示，不影响项目本身
12. 并发新建 2 个项目，互不干扰

### 15.3 代码质量

13. `packages/web-server` ≥ 80% 单元测试覆盖（核心 route + service）
14. `packages/agents` 的 ModelAdapter / Coordinator 有集成测试（mock agent 输出）
15. `packages/web-ui` 主页面有 E2E 测试（playwright 或 vitest + testing-library）
16. 所有测试 `pnpm test` 一次全绿

## 16. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| codex/claude CLI 鉴权失效 | 所有 agent 都跑不了 | 启动时健康检查（发个小 prompt 验证），UI 显示 CLI 状态 |
| 专家输出不是结构化 md | Coordinator 合成失败 | 专家 prompt 模板严格，附带 JSON-schema 提示；parse 失败降级为 raw text + 警告 |
| Round 1 并行跑太多（5+ 专家）打爆 CLI rate limit | 整轮中断 | 并发上限配置（默认 3），其余排队 |
| SSE 连接数过多卡前端 | UI 卡顿 | 每浏览器 tab 一条流即可；切换项目断掉旧流 |
| docx/pdf 解析质量差 | Brief 摘要不准 | 原始文件保留在 `brief/raw/`，UI 显示"原始文件"链接让用户对照 |
| Vault 文件被 Obsidian 同时编辑导致写冲突 | 数据错乱 | 写文件前 `stat` 对比 mtime，变了则警告用户 |
| refs-pack 检索召回太少 | 专家缺素材 | 实现时先用宽松 query，不行再加精确过滤 |

## 17. 未来扩展（SP-02 不实施，但 schema/架构预留）

- 专家自动蒸馏：独立子项目，产出同 schema 的 `*_kb.md` drop-in
- Style panel 扩展到多品牌：`style-panel/index.yaml` 多条目
- Mission 版本历史：目前覆盖写 `selected.md`，将来可加 `selected.v1.md` / `.v2.md`
- 跨项目 wiki 层：把项目产出的 Mission 反向沉淀为 wiki 页（Karpathy 模式）

## 18. 实施顺序（交 writing-plans 细化）

预估 18-22 个 task，大约 2-3 周：

1. 仓库初始化（pnpm workspace + 三个 packages 骨架）
2. `packages/agents` ModelAdapter + 基类 + 单元测试
3. `packages/agents` Brief Analyst + prompt 模板
4. `packages/web-server` Fastify 骨架 + 项目 CRUD route
5. file-extractor（docx/pdf/md/txt → md）
6. url-fetcher（readability）
7. Brief 上传 route + 触发 Analyst
8. `packages/web-ui` Vite 骨架 + 项目列表页 + 新建项目表单
9. BriefIntakeForm + 集成到上传 API
10. BriefSummaryCard + 路由
11. SSE 事件流（后端 + 前端 hook）
12. AgentTimeline 组件
13. 专家注册 + 加载（读 index.yaml）+ ExpertSelector
14. 从 ai-kepu-panel 拷贝 KB 到 vault
15. topic_expert agent 角色实现
16. Coordinator agent（round1 合成逻辑）
17. Round 1 端到端（mission/start 触发并行跑）
18. Round 2 评分逻辑
19. `candidates.md` 渲染 + MissionCandidateCard
20. 选定 Mission → selected.md + SelectedMissionView
21. 端到端集成测试（fake LLM 出固定输出）
22. 真机 e2e（用真 codex/claude 跑一次 MetaNovas Brief）

## 19. 验收与交付

- 代码位于 `packages/web-server/`, `packages/web-ui/`, `packages/agents/`
- Vault 更新 `08_experts/topic-panel/`, 样式卡 `style-panel/十字路口_kb.md` 已存在
- 设计系统参考 `end_to_end-layout/DESIGN.md`（绿色主题 #407600）
- 启动：`pnpm dev` 一键
- spec 通过后调用 `writing-plans` 产出实施计划
