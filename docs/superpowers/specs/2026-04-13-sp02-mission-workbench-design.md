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
  "slug": "metanovas-review",
  "status": "awaiting_mission_pick",
  "stage": "mission",
  "article_type": "product-review",
  "expected_word_count": null,
  "deadline": null,
  "priority": "normal",
  "tags": ["测评", "MetaNovas", "B2B"],
  "client": {
    "name": null,
    "brand": "MetaNovas",
    "product": "MetaClaw"
  },
  "brief": {
    "source_type": "docx",
    "raw_path": "brief/raw/brief.docx",
    "md_path": "brief/brief.md",
    "summary_path": "brief/brief-summary.md",
    "uploaded_at": "2026-04-13T12:00:00+08:00"
  },
  "product_info": {
    "name": "MetaClaw",
    "official_url": "https://metanovas.example.com",
    "trial_url": null,
    "docs_url": null,
    "fetched_path": "context/product-fetched.md",
    "notes": "2026 年 Q2 上线"
  },
  "experts_selected": ["赛博禅心", "数字生命卡兹克"],
  "mission": {
    "candidates_path": "mission/candidates.md",
    "selected_index": null,
    "selected_path": null,
    "selected_at": null,
    "selected_by": null
  },
  "runs": [
    {
      "id": "run-1",
      "stage": "mission",
      "started_at": "2026-04-13T12:05:00+08:00",
      "ended_at": "2026-04-13T12:09:34+08:00",
      "experts": ["赛博禅心", "数字生命卡兹克"],
      "status": "completed"
    }
  ],
  "created_at": "2026-04-13T12:00:00+08:00",
  "updated_at": "2026-04-13T12:34:56+08:00",
  "schema_version": 1
}
```

**字段说明**：
- `status` / `stage`：当前状态机位置（见 §12），stage 是粗粒度（intake/mission/case/…）
- `article_type`：`product-review` / `industry-analysis` / `interview` / `tutorial` / …（枚举，SP-02 首版 3-5 种）
- `priority`：`low` / `normal` / `high`（UI 排序用）
- `tags`：用户自由标签，用于项目列表筛选
- `client.*`：从 Brief Analyst 自动填，用户可改
- `brief.source_type`：`docx` / `pdf` / `md` / `txt` / `text`（直接粘贴）
- `product_info.*`：用户在 Intake 表单填 + URL fetch 补全
- `experts_selected`：本次 run 选中的专家列表
- `mission.selected_index`：1/2/3（candidates 里哪个被选）
- `runs[]`：本项目历次 Mission run 历史（每次重跑一个新 run-id，保留）
- `schema_version`：未来迁移兼容

### 6.3 brief-summary.md frontmatter

```yaml
---
type: brief_summary
project_id: metanovas-review
generated_by: brief_analyst
generated_at: 2026-04-13T12:02:30+08:00
model_used: claude-sonnet

# 基础识别
client: 深圳某科技公司
brand: MetaNovas
product: MetaClaw
product_category: AI Agent 协作平台
product_stage: launched  # prelaunch | launched | iteration | end-of-life

# 传播目标
goal: 向 AI 内容创作者传播 MetaClaw 的多 Agent 协作能力
goal_kind: awareness  # awareness | conversion | retention | thought_leadership
audience:
  primary: AI 内容创作者 / 技术型博主
  secondary: 运营/市场负责人
  persona_keywords: ["coding Agent", "多模态", "中文"]

# 内容约束
key_messages:
  - "多 Agent 协作是品牌内容生产的解药"
  - "MetaClaw 的 Workflow DSL 可被非技术同学使用"
value_props:
  - "流程可视化"
  - "原生中文理解"
  - "社区模板生态"
forbidden_claims:
  - "不要说「替代人类写手」"
  - "不要对标具体友商（比如 XXX）做贬低对比"
must_cover_points:
  - "Workflow 编排界面"
  - "与 Claude/Codex 的集成"
avoid_angles:
  - "纯技术深度（掉粉）"
  - "过度 PR 调"

# 语气与形式
tone:
  voice: 克制专业
  forbidden_words: ["炸裂", "颠覆"]
  preferred_words: ["实测", "我们发现", "挺稳"]
style_reference: "十字路口 Crossing"  # 对应 style-panel 的一张卡

# 交付
required_deliverables:
  - format: wechat_article
    word_count_range: [3000, 5000]
    with_images: true
  - format: x_thread
    word_count_range: [300, 600]
deadline: 2026-05-15
deadline_strictness: soft  # soft | hard

# 信息缺口
gap_notes:
  - "Brief 没说是否允许爆料未上线功能"
  - "目标读者群的具体画像还要进一步澄清"
confidence: 0.78  # Brief 信息完整度，0-1
---

# Brief 摘要

<自然语言总结 ~300 字，包含客户背景、产品核心、传播目的、读者画像、
 关键信息、禁区、语气、交付要求。段落形式，便于专家阅读。>

## 原始 Brief 关键片段

> <引用 Brief 里最关键的 3-5 段原文，带段落来源>

## Brief Analyst 的判断

<1-2 段 Analyst 对这个 brief 的独立判断：传播难度、潜在陷阱、
 建议优先探索的角度。>
```

### 6.4 mission/candidates.md

```yaml
---
type: mission_candidates
project_id: metanovas-review
run_id: run-1
generated_by: coordinator
generated_at: 2026-04-13T12:08:12+08:00
model_used: claude-opus
experts_round1: ["赛博禅心", "数字生命卡兹克"]
experts_round2: ["赛博禅心", "数字生命卡兹克"]
round2_rankings:
  - candidate_index: 2
    aggregate_score: 8.5
  - candidate_index: 1
    aggregate_score: 7.0
  - candidate_index: 3
    aggregate_score: 6.2
final_order: [2, 1, 3]   # 按排名决定 UI 显示顺序
---

# 候选 1

## 元数据
- **角度名称**：Workflow DSL 的低门槛样本
- **文章类型**：product-review
- **推荐标题方向**（不是最终标题）：
  - "MetaClaw 的 Workflow 编辑器：把多 Agent 从玩具变成工具"
  - "我们用 MetaClaw 复刻了一份内容生产线"
- **综合评分**（round2 aggregate）：7.0 / 10

## Mission 字段
- **primary_claim**：MetaClaw 的 Workflow DSL 是非技术同学也能编排多 Agent 的关键
- **secondary_claims**:
  - "它解决了多 Agent 系统的最大门槛：流程可视化"
  - "对中文 prompt 的原生支持让国内创作者不需要重学英文"
- **must_cover**:
  - 编辑器的可视化体验（截图）
  - 至少 1 个真实 workflow 示例
- **avoid**:
  - 不要比 LangGraph（会被当成对立 PR）
  - 不要提未上线的 v2 功能
- **recommended_structure**: "问题切入 → 工具演示 → 工作流示例 → 行业判断"
- **target_audience_fit**: 0.85  # 专家评估对目标读者的契合度

## 支撑论据（来自 Brief + refs-pack）
- Brief §3 明确提到"非技术同学"
- refs-pack.md 里 3 篇同类评测（卡兹克/苍何/硅星人）都提到"多 Agent 系统难门槛"
- Coordinator 交叉验证：赛博禅心 round1 提出类似角度（详见 round1/赛博禅心.md）

## Round 2 评审摘要
- **赛博禅心**：7/10，风险=容易写成 workflow 教程手册
- **数字生命卡兹克**：7/10，风险=需要至少 2 段视频演示否则抽象

# 候选 2

## 元数据
...
（同上结构）

# 候选 3
...
```

### 6.5 mission/selected.md（SP-02 最终产出）

```yaml
---
type: mission
project_id: metanovas-review
run_id: run-1
selected_from: candidates.md#候选 2
candidate_index: 2
approved_by: human
approved_at: 2026-04-13T12:34:56+08:00
human_edits: true  # 用户是否编辑过候选内容
edit_summary: "加了一条 avoid: 不要用「降本增效」套话"

# 可追溯
brief_summary_path: brief/brief-summary.md
refs_pack_path: context/refs-pack.md
round1_expert_files:
  - mission/round1/赛博禅心.md
  - mission/round1/数字生命卡兹克.md
round2_expert_files:
  - mission/round2/赛博禅心.md
  - mission/round2/数字生命卡兹克.md

# 最终 Mission 字段（供 SP-03 Case Planner 使用）
article_type: product-review
primary_claim: <一句话主命题>
secondary_claims:
  - ...
must_cover:
  - ...
avoid:
  - ...
recommended_structure: "..."
tone_reference: "十字路口 Crossing"
target_audience_fit: 0.85
---

# Mission

## 主命题
<3-4 句话展开主命题 + 为什么选这个角度>

## 次命题
- <次命题 1> — <展开>
- <次命题 2> — <展开>

## 必打点
- <必打点 1>
- <必打点 2>

## 避免角度
- <避免 1> — <为什么>
- <避免 2>

## 推荐文章结构骨架
<给 SP-03 Writer 用的初步结构建议，可以被修改>

## 依据与溯源
- Brief 摘要：brief/brief-summary.md
- 专家意见见 round1/ + round2/
- refs-pack：context/refs-pack.md（Top 30 历史参考文）
- Coordinator 合成版本：mission/candidates.md 候选 2
```

SP-03 Case Planner 读这个 md 的 frontmatter 和正文即可启动。

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
run_id: run-1
kb_source: 08_experts/topic-panel/experts/赛博禅心_kb.md
model_used: claude-opus
started_at: 2026-04-13T12:05:30+08:00
ended_at: 2026-04-13T12:06:48+08:00

# 对整个 brief 的评估
brief_score: 8   # 1-10 这个 brief 本身的传播潜力
brief_confidence: 0.7   # 这位专家对自己判断的置信度
viability_flags:
  - "产品在做差异化定位"
  - "目标读者群匹配本号风格"

# 本专家查询了哪些 refs（如果用了逃生舱工具）
refs_queries_made:
  - query: "multi-agent workflow 编辑器"
    hits: 4
  - query: "Agent DSL 对比"
    hits: 2
refs_cited:
  - path: 10_refs/量子位/2026/....md
    why: "同类 workflow 编辑器的历史评测"

# 该专家觉得可行的 3 个角度
angles:
  - name: "多 Agent 门槛问题的历史拆解"
    seed_claim: "多 Agent 系统过去 1 年都没走出玩具阶段的根因是……"
    rationale: "符合本号深度类写作的口味，历史类比切入易出彩"
    fit_score: 9
    risk: "容易写散，要锚定到 MetaClaw 的具体能力"
  - name: "..."
    ...
  - name: "..."
    ...
---

# 我对这个选题的看法
<300-500 字，本专家视角的完整思考，可被 Coordinator 引用>
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
project_id: metanovas-review
run_id: run-1
kb_source: 08_experts/topic-panel/experts/赛博禅心_kb.md
model_used: claude-opus
started_at: ...
ended_at: ...

scores:
  - candidate_index: 1
    score: 7
    strengths:
      - "切入有新意"
    weaknesses:
      - "容易被读者当成教程"
    fatal_risk: "如果视频演示做不好，整个角度成立不了"
    would_pick: false
  - candidate_index: 2
    score: 9
    strengths:
      - "和本号文风对口"
      - "refs-pack 里有充足支撑"
    weaknesses:
      - "叙事密度要求高"
    fatal_risk: "写手功力不够会写成流水账"
    would_pick: true
  - candidate_index: 3
    score: 6
    strengths:
      - "角度独特"
    weaknesses:
      - "和目标读者兴趣不匹配"
    fatal_risk: "读者流失率高"
    would_pick: false

overall_recommendation: 2
---

# 综合判断
<200-400 字：这位专家为什么这样排序，对整体候选集的印象>
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
