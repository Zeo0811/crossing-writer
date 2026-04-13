# 子项目 3：Case Plan 工作台（产品概览 + Case 规划）— 设计 Spec

- 日期：2026-04-13
- 所属项目：crossing-writer
- 子项目编号：SP-03
- 状态：draft（等待 review）
- 前置依赖：SP-01（Vault + refs.sqlite）、SP-02（Web 工作台 + Mission 两轮评审）已合并到 main

---

## 1. 背景

SP-02 把流水线 ①-② 打通：甲方 Brief 进来 → 专家团两轮评审 → 定出 Mission。SP-03 承接 Mission，把 ③-④ 做完：

```
③ 产品概览（用户上传 Brief 配图 + 产品截图 + URL → Overview Agent 生成产品理解卡）
   ↓ [人审批 overview，可编辑]
④ Case 规划（Case 专家团 + 一轮 tool loop + 细粒度 inspiration pack → N 个候选 Case）
   ↓ [人选 2-4 个]
SP-03 终点：case_plan_approved
```

SP-03 终点之后用户**离线**去真人实测（用 Case 上的 steps/prompts 跑产品、截图、录屏、备注），SP-04 接 Evidence 上传和归类。

## 2. 非目标（SP-03 明确不做）

- ❌ Evidence 上传 / 归类 / Evidence Pack 生成（SP-04）
- ❌ Writer（标题/开头/实测正文/结尾 4 子 agent）（SP-05）
- ❌ Review / 审稿专家团 / 导出（SP-06）
- ❌ 自动产品截图抓取（Playwright 等重型爬虫）
- ❌ 自动跑产品的 Agent（RPA 类，很远的事）
- ❌ Case 执行进度追踪 UI（用户线下做，系统只提供引导清单）
- ❌ 多轮 tool loop（N 轮 agent↔工具对话；首版只做 1 轮）
- ❌ 视频/GIF 识别（Overview 只吃静态图 + 文字；视频留给 SP-04 Evidence）

## 3. 用户故事

### 3.1 主流程

接 SP-02 mission_approved 之后：

1. 左侧显示已选定的 Mission，顶部状态自动转 `awaiting_overview_input`
2. 右侧弹 `OverviewIntakeForm`：
   - **Brief 配图上传区**（支持多图，可标"来自 Brief"）
   - **产品截图上传区**（支持多图）
   - **产品文档 URL 列表**（官网、试用、API 文档、案例页）
   - **产品描述文本框**（用户自己对产品的理解，可选）
3. 点"生成产品概览" → 状态 `overview_analyzing`
4. Overview Agent（vision-capable）读所有图 + 文字 + URL fetched → 产出 `context/product-overview.md`
5. 状态 `overview_ready`，左侧展开 **ProductOverviewCard**（可编辑），右侧给"批准进入 Case 规划"按钮
6. 点批准 → 状态 `awaiting_case_expert_selection`，右侧弹 **CaseExpertSelector**
   - 默认勾选 = Mission 用过的专家 ∪ Top 3 创意高分专家（取并集，最多 5 位）
7. 点"开跑 Case 规划" → 状态 `case_planning_running`
8. 每位专家并行执行：
   - Round 1：读 Mission + product-overview + inspiration-pack → 输出 Case 草稿，可以在输出里发 `crossing-kb search` 工具调用
   - 工具循环一次：系统执行工具，结果塞回给专家 → 专家 Round 2 输出最终 Case
9. 状态 `case_synthesizing`，Coordinator 汇总/去重 N 个 Case → `mission/case-plan/candidates.md`
10. 状态 `awaiting_case_selection`，左侧展开 **CaseListPanel**，每张 Case 卡片带"选中"checkbox
11. 用户选 2-4 个 case → 点"批准并进入实测准备"
12. 状态 `case_plan_approved`
13. 右侧显示**实测引导卡**：列选定 Case 的 steps + prompts + screenshot_points，方便用户打印/复制去做实测

### 3.2 副故事

- 重跑 Case 规划（同一 Mission 换 Case 专家再跑一遍）
- 编辑 Overview（用户觉得 Agent 理解错了，直接改 md）
- 编辑 Case（选之前微调某个 Case 的 steps/prompts）

## 4. 技术栈

SP-03 继承 SP-02 的 monorepo：

- `packages/agents/`：新增 ProductOverviewAgent、CasePlannerExpert、CaseCoordinator 角色 + 对应 prompt 模板；**扩展 ModelAdapter 支持 images attachment**
- `packages/web-server/`：新增 `/api/projects/:id/overview/*`、`/api/projects/:id/case-plan/*` 路由；新增 `OverviewAnalyzerService` 和 `CasePlanOrchestrator` 服务；**扩展 ExpertRegistry 读取 `creativity_score` 字段**
- `packages/web-ui/`：新增 OverviewIntakeForm、ProductOverviewCard、CaseExpertSelector、CaseListPanel、CaseSelectedGuide 组件；扩展 ProjectWorkbench 布局为"section 折叠叠加"模式

无新外部依赖（image 上传复用 `@fastify/multipart`；vision 调用复用 claude/codex CLI 的原生图片支持）。

## 5. 物理布局

### 5.1 Vault 新增目录

```
~/CrossingVault/07_projects/<id>/
  context/
    images/                                ← 新增
      brief-fig-1.png                      ← Brief 配图（用户补传）
      brief-fig-2.png
      screenshot-1.png                     ← 产品截图
      screenshot-2.png
      ...
    product-overview.md                    ← Overview Agent 产出（新增）
    product-fetched.md                     ← 已有（SP-02 URL fetching）
    refs-pack.md                           ← Mission 阶段产物
    case-inspiration-pack.md               ← Case 阶段新增（Coordinator 预热）
  mission/
    selected.md                            ← SP-02 产物（Case 阶段读它）
    case-plan/                             ← 新增子目录
      round1/
        <expert>.md                        ← 每位专家 round1 输出
        <expert>.round2.md                 ← tool loop 后的 round2 输出
      candidates.md                        ← Coordinator 汇总的 N 个候选 Case
      selected-cases.md                    ← 用户选定的 2-4 个 Case（SP-03 终点）
```

### 5.2 Vault 专家注册表字段扩展

`~/CrossingVault/08_experts/topic-panel/index.yaml` 每位专家加 `creativity_score` 字段（1-10），标注该专家提出创意 Case 的强度：

```yaml
experts:
  - name: 数字生命卡兹克
    file: experts/数字生命卡兹克_kb.md
    active: true
    default_preselect: true        # Mission 默认预选
    creativity_score: 9             # 新增：Case 阶段的创意权重
    specialty: ...
  - name: 赛博禅心
    creativity_score: 7
    ...
```

**创意分布（v1 手动标）**：卡兹克/卡尔 9 · 袋鼠帝/苍何/阿颖 8 · 赛博禅心/AGENT橘/硅星人 7 · 黄叔/逛逛GitHub 6

### 5.3 Repo 新增文件

```
packages/agents/src/
  prompts/
    product-overview.md                    ← 新增（vision prompt）
    case-expert-round1.md                  ← 新增
    case-expert-round2.md                  ← 新增（tool loop 后的 refinement）
    case-coordinator.md                    ← 新增
  roles/
    product-overview-agent.ts              ← 新增
    case-planner-expert.ts                 ← 新增
    case-coordinator.ts                    ← 新增

packages/web-server/src/
  routes/
    overview.ts                            ← 新增
    case-plan.ts                           ← 新增
  services/
    overview-analyzer-service.ts           ← 新增
    case-plan-orchestrator.ts              ← 新增
    image-store.ts                         ← 新增（上传/读取/枚举 context/images/）
    case-inspiration-pack-builder.ts       ← 新增（比 Mission refs-pack 细）

packages/web-ui/src/
  components/
    right/
      OverviewIntakeForm.tsx               ← 新增（3 类上传 + URL + 文本）
      CaseExpertSelector.tsx               ← 新增（复用 Mission 那个 + default preselect 策略）
      CaseSelectedGuide.tsx                ← 新增（SP-03 终态引导清单）
    left/
      ProductOverviewCard.tsx              ← 新增（可编辑 md 预览）
      CaseListPanel.tsx                    ← 新增（多选 + 编辑）
      CaseCardPreview.tsx                  ← 新增（单个 Case 展开）
      SectionAccordion.tsx                 ← 新增（左侧折叠式叠加容器）
  hooks/
    useOverview.ts                         ← 新增
    useCaseCandidates.ts                   ← 新增
```

## 6. 数据模型

### 6.1 `context/product-overview.md` frontmatter

```yaml
---
type: product_overview
project_id: <id>
generated_by: product_overview_agent
generated_at: <iso>
model_used: <claude-opus | codex-gpt5 | ...>
input_sources:
  brief_figures:
    - context/images/brief-fig-1.png
    - context/images/brief-fig-2.png
  product_screenshots:
    - context/images/screenshot-1.png
    - context/images/screenshot-2.png
    - context/images/screenshot-3.png
  product_urls:
    - https://pixverse.ai
    - https://docs.pixverse.ai
  user_description: "用户给的 1-2 段描述"

# 结构化结果
product_name: MetaClaw
product_category: 多 Agent 工作流编排平台
core_capabilities:
  - 多 Agent 流程编排
  - Workflow DSL
  - 原生中文支持
key_ui_elements:
  - 可视化画布
  - 节点库
  - 中文 prompt 输入框
typical_user_scenarios:
  - 非技术同学编排内容生产流水线
  - 多步骤任务自动化
differentiators:
  - 中文母语理解
  - 零代码 DSL
confidence: 0.75                    # Agent 对这份 overview 的自评置信度
gaps:
  - "没能从截图看出定价模型"
  - "API 文档链接失效"
human_edited: false                 # 用户编辑过就变 true
edited_at: null
---

# 产品概览
<300-500 字自然语言总结：这是什么产品 / 给谁用 / 怎么用 / 有什么特色>

## 核心能力
<列表展开 core_capabilities>

## 典型使用场景
<1-3 个场景描述>

## 界面观察
<from screenshots — 描述 UI 结构、关键按钮、用户流>

## 对 Mission 的启示
<Agent 分析本次 Mission 的命题能被产品哪些能力最佳支撑>

## 空白与风险
<gaps 展开>
```

### 6.2 `mission/case-plan/candidates.md` frontmatter

```yaml
---
type: case_plan_candidates
project_id: <id>
run_id: case-run-<ts>
generated_by: case_coordinator
generated_at: <iso>
experts_participated:
  - 数字生命卡兹克
  - 卡尔的AI沃茨
  - 赛博禅心
total_cases: 6                    # 去重后数量
---

# Case 01 — 多宫格分镜直出
<完整 Case 字段见 §6.3>

# Case 02 — 打斗动作连贯性压测
...

# Case 06 — ...
```

### 6.3 单个 Case 的 frontmatter schema

```yaml
---
type: case
case_id: case-01
name: "多宫格分镜直出"
proposed_by: 数字生命卡兹克
creativity_score: 9/10            # 专家自评
why_it_matters: "多宫格直出是 C1 主打但很少被实测的能力"
supports_claims: [primary_claim, secondary_claim_1]

# 执行步骤
steps:
  - step: 1
    action: "准备九宫格分镜图（可用 Nano Banana Pro 生成）"
    prep_required: true
  - step: 2
    action: "访问 PixVerse Web 端，选 C1 模型"
  - step: 3
    action: "上传九宫格图，输入提示词，点生成"

# Prompts
prompts:
  - purpose: "古装玄幻场景"
    text: |
      古代山门宗派入口，两名修士对峙，拔剑相向，真气碰撞产生粒子爆炸...
  - purpose: "现代都市动作"
    text: |
      暴雨屋顶，双胞胎武者对决，刀光溅起水花，慢镜头切换...

# 媒体产物期望
expected_media:
  - kind: video                   # image | video | audio | text
    spec:
      resolution: "1080p"
      duration_s: 15
      expected_count: 2
  - kind: image
    spec:
      dimensions: "1920x1080"
      expected_count: 1           # 过程中的关键帧

# 写作时的观察点
observation_points:
  - "角色服装配色一致性"
  - "碰撞瞬间粒子效果质量"
  - "运镜节奏变化"

# 实测执行指引
screenshot_points:
  - "九宫格输入的上传页"
  - "模型选择界面"
  - "最终视频播放页"
recording_points:
  - "生成过程（等待/进度条）"
  - "视频本身（原始分辨率）"

# 风险预判
risks:
  - "模型可能生成混乱分镜切换"
  - "古装人物容易崩脸"
predicted_outcome: |
  成功：连贯 15s 视频 + 角色一致性保持
  失败：分镜跳跃 + 角色换人

# 参考来源（专家借鉴的素材）
inspired_by:
  - ref_path: 10_refs/数字生命卡兹克/2026/2025-12-15_实测Sora.md
    what_borrowed: "多分镜一次性生成的测试套路"
  - ref_path: 10_refs/量子位/2026/2026-01-20_Runway新模型.md
    what_borrowed: "分辨率对比方法"

# Tool loop 痕迹（SP-03 独有）
tool_calls_made:                  # 专家在 round1→round2 之间调用过的工具
  - query: "AI 视频模型 实测"
    account: "数字生命卡兹克"
    returned_count: 5
---

# 详细说明
<500-1000 字：专家解释为什么这样设计、预期看到什么、人工执行时需要注意什么>
```

### 6.4 `selected-cases.md`（SP-03 最终产出）

```yaml
---
type: case_plan
project_id: <id>
selected_from: mission/case-plan/candidates.md
selected_indices: [1, 3, 5]       # 用户选的候选序号
selected_count: 3
approved_by: human
approved_at: <iso>
human_edits_applied: false        # 用户选前有没有改过 case 内容
mission_ref: mission/selected.md
product_overview_ref: context/product-overview.md
---

# 已选 Cases

## Case 01 — 多宫格分镜直出
<完整 case 字段>

## Case 03 — 打斗动作连贯性压测
...

## Case 05 — 术法特效边界测试
...

# 实测引导（给人看的 checklist）

### 准备
- [ ] 准备 1 张九宫格分镜图（Nano Banana Pro）
- [ ] 准备录屏工具（Screen Studio / QuickTime）
- [ ] 登录 PixVerse Web

### Case 01 执行
- [ ] 跑 steps 1-3
- [ ] 按 prompt "古装玄幻场景" 生成
- [ ] 截图：上传页 / 模型选择 / 播放页
- [ ] 录屏：生成过程 + 最终视频
- [ ] 备注：服装一致性 / 粒子效果 / 运镜
- ...
```

### 6.5 `project.json` 字段扩展

在 SP-02 的基础上加：

```json
{
  "overview": {
    "images_dir": "context/images",
    "overview_path": "context/product-overview.md",
    "generated_at": "...",
    "human_edited": false
  },
  "case_plan": {
    "experts_selected": ["卡兹克", "卡尔", "赛博禅心"],
    "candidates_path": "mission/case-plan/candidates.md",
    "selected_path": null,
    "selected_indices": null,
    "selected_count": 0,
    "approved_at": null
  }
}
```

## 7. Agent 架构

### 7.1 ProductOverviewAgent

- **Input**：Brief 配图（N）+ 产品截图（N）+ URL fetched markdown + 用户描述文本 + Mission 摘要
- **Output**：上面 §6.1 的 product-overview.md
- **Vision required**：是（需处理图片）
- **默认 CLI/model**：`claude` + `opus`（sonnet 也支持 vision 但推理力不够理解复杂 UI）。`config.json` 可以用 `product_overview_agent` key 覆盖

### 7.2 CasePlannerExpert（每位激活专家一个实例）

- **Round 1**：
  - **Input**：Mission selected.md + product-overview.md + case-inspiration-pack.md + 专家自己的 KB
  - **Output**：`round1/<expert>.md`（含 Case 草稿 + 可选的 ```tool\ncrossing-kb search ...``` 块）
  - **Vision required**：否（已经读过 overview 的文字版就够）
- **Round 2**（如有 tool call）：
  - **Input**：Round 1 的输出 + 工具执行结果
  - **Output**：`round1/<expert>.round2.md`（细化后的 Case）
  - **如果 Round 1 没发 tool call**：跳过 Round 2，直接把 Round 1 的 Case 视为最终
- **默认 CLI/model**：每位专家看 `config.json` 的 `case_expert.<name>` 配置，默认走 `topic_expert.default`（保持和 Mission 一致）

### 7.3 CaseCoordinator

- **Input**：所有专家的最终 Case 输出（合并 round1 no-tool 版和 round2 refined 版）+ Mission + product-overview
- **Output**：`mission/case-plan/candidates.md`（N 个 Case，去重后）
- **Vision required**：否
- **默认 CLI/model**：`claude + opus`（和 Mission Coordinator 对齐）

### 7.4 tool-runner 循环实现

这是 SP-03 的**新技术点**——真正实现 agent↔tool 单轮循环：

```ts
// packages/agents/src/case-expert-runner.ts（新增）
async function runCaseExpert(expert, ctx): Promise<FinalCaseOutput> {
  // Round 1
  const r1 = await expert.round1(ctx);
  const toolCalls = parseToolCalls(r1.text);
  if (toolCalls.length === 0) {
    return { final: r1, roundsUsed: 1 };
  }
  // 执行工具
  const toolResults = toolCalls.map(tc => {
    if (tc.command === "crossing-kb" && tc.args[0] === "search") {
      return runCrossingKbSearch(tc.args);
    }
    return { ok: false, error: `unknown tool: ${tc.command}` };
  });
  // Round 2
  const r2 = await expert.round2({ prevOutput: r1.text, toolResults, ctx });
  return { final: r2, roundsUsed: 2, tool_calls_made: toolCalls };
}
```

这个 runner 取代了 SP-02 的简单 `agent.round1()` 单次调用。

## 8. inspiration pack 的"细粒度"抽取

SP-02 的 refs-pack 只有 `title + account + summary + mdPath`。SP-03 新 Coordinator 预热时要**读到每篇文章内容**，抽出两类段落：

1. **Prompt 段落**：识别 markdown 里的 fenced code block（`` ``` `` 包起来的），或紧跟"提示词如下"/"prompt"/"Prompt" 的段落
2. **步骤段落**：识别带编号列表或"Case X"标题下的一两段

然后拼成 `case-inspiration-pack.md`：

```markdown
---
type: case_inspiration_pack
queries: ["AI 视频 实测", "垂直模型"]
total_sources: 18
---

# Inspiration Pack

## 1. 《AI 漫剧爆了 25 亿播放后》— 十字路口Crossing 镜山 2026-04-08

**Prompts used**:
```
古代山门宗派入口，两名修士对峙...
```

**Test steps**:
1. 准备九宫格分镜图
2. 选 C1 模型
3. ...

**Observation angles**:
- 分镜衔接顺畅度
- 服装配色一致性

---

## 2. 《实测 Sora》— 数字生命卡兹克 2025-12-15
...
```

实现细节：SP-01 的 extractor 已经产出 body_plain + body_segmented；这里用 **简单正则 + 启发式** 抽段。首版不过度设计（不用 LLM 抽段，太贵）。

## 9. 三类图片上传

### 9.1 上传 endpoint

```
POST /api/projects/:id/overview/images
Content-Type: multipart/form-data
Fields:
  - file: 图片文件
  - source: "brief" | "screenshot"   ← 标注来源
  - label?: string                    ← 可选描述
```

Server 落盘到 `context/images/`，文件名规则：
- brief 图：`brief-fig-<N>.<ext>`（N 自增）
- 截图：`screenshot-<N>.<ext>`

同一项目 `DELETE /api/projects/:id/overview/images/:filename` 支持删除。

### 9.2 图片限制

- 单张 ≤ 10 MB
- 格式：png / jpg / webp
- 每个项目累计 ≤ 30 张
- 超限给明确错误

### 9.3 Vision Agent 调用

`invokeAgent()` 接口扩展：

```ts
interface InvokeOptions {
  // ... 原有字段
  images?: string[];        // 图片文件的**绝对路径**数组
}
```

- **claude**：根据 `claude --help` 实际 flag（2026-04 版本支持 `--image /path` 或 `-i /path`，实施时以 `claude -p --help` 实际输出为准，首版检测一次后硬编码）
- **codex**：`codex exec -i /abs/path1.png -i /abs/path2.png "..."`（已验证 SP-01 tag 阶段 codex 0.120 支持 `-i`）
- 如果 cli 不支持 image 而被调用 → 抛 `ImageNotSupportedError`，UI 提示用户在 `config.json` 改 `product_overview_agent.cli`
- 图片路径传进去**前必须是绝对路径**，subprocess cwd 可能是 worktree 不同位置

## 10. API 设计

### 10.1 Overview

- `POST /api/projects/:id/overview/images` — 上传单张图片（multipart）
- `GET /api/projects/:id/overview/images` — 列图片清单
- `DELETE /api/projects/:id/overview/images/:filename`
- `POST /api/projects/:id/overview/generate` — 触发 Overview Agent
  - body: `{ productUrls: string[], userDescription?: string }`
- `GET /api/projects/:id/overview` — 读 product-overview.md（markdown）
- `PATCH /api/projects/:id/overview` — 用户编辑后提交（raw md）
- `POST /api/projects/:id/overview/approve` — 批准 → 进 `awaiting_case_expert_selection`

### 10.2 Case Plan

- `GET /api/projects/:id/experts/case` — 带 `default_preselect` 的 case 专家列表（= Mission 已选 ∪ 创意 Top 3）
- `POST /api/projects/:id/case-plan/start` — 开跑
  - body: `{ experts: string[] }`
- `GET /api/projects/:id/case-plan/candidates` — 读 candidates.md
- `POST /api/projects/:id/case-plan/select` — 批准选定
  - body: `{ selectedIndices: number[], edits?: { [index: number]: CaseEdit } }`
- `GET /api/projects/:id/case-plan/selected` — 读 selected-cases.md

### 10.3 SSE（复用 SP-02 的 stream route）

新增事件类型（都 publish 到已有 broadcaster）。**所有 agent 相关事件必须带 `cli` 和 `model` 字段**，让 UI 能展示"谁在跑用什么模型"：

- `overview.started` — `{ agent: "product_overview", cli, model }`
- `overview.completed` / `overview.failed` — 同上 + `durationMs` / `error`
- `case_expert.round1_started` — `{ agent: "case_expert.<name>", expert, cli, model }`
- `case_expert.round1_completed`
- `case_expert.tool_call` — `{ expert, command, args }`
- `case_expert.round2_started` / `case_expert.round2_completed`
- `case_coordinator.synthesizing` — `{ agent: "case_coordinator", cli, model }`
- `case_coordinator.done`

**同步回溯修 SP-02 已有事件**：`agent.started` / `expert.round1_started` / `expert.round2_started` / `coordinator.synthesizing` 这些也加上 `cli` 和 `model` 字段。这是破坏性改动，SP-03 Task 1 做（影响现有 SSE 消费者只有 AgentTimeline，一次改完）。

## 11. UI 组件设计

### 11.1 Workbench 改造：SectionAccordion

把原来的 "左侧按 status 渲染单一组件" 改成 **section 叠加**：

```tsx
<Accordion>
  <Section title="Brief 摘要" status="completed" defaultCollapsed>
    <BriefSummaryCard />
  </Section>
  <Section title="Mission 选定" status="completed" defaultCollapsed>
    <SelectedMissionView />
  </Section>
  <Section title="产品概览" status="active">  {/* 当前阶段自动展开 */}
    <ProductOverviewCard />
  </Section>
  <Section title="Case 列表" status="pending">
    （未开始）
  </Section>
</Accordion>
```

规则：
- 已完成 section → 可折叠、默认折叠条
- 当前活跃 section → 默认展开
- 未开始 section → 灰色禁用，不能点开

### 11.2 右侧阶段性面板（按 status 切换）

```
created / brief_uploaded / brief_analyzing / brief_ready → SP-02 已有
mission_* → SP-02 已有
awaiting_overview_input → OverviewIntakeForm
overview_analyzing → "正在生成概览…"
overview_ready → OverviewApproveBar（批准按钮）
awaiting_case_expert_selection → CaseExpertSelector
case_planning_running / case_synthesizing → "规划中…"（+ 时间线自动展开）
awaiting_case_selection → CaseSelectionBar（提示"左侧选 2-4 个"）
case_plan_approved → CaseSelectedGuide（实测引导清单，支持导出 PDF/Markdown）
```

**AgentTimeline 一直在右侧底部**，订阅新事件类型。

### 11.2.1 AgentTimeline 改造（SP-03 必做）

原 SP-02 的 AgentTimeline 只显示事件类型 + 时间，信息太少。SP-03 改造成这样的行结构：

```
14:32:15  ●  Brief Analyst · claude/sonnet                   开始解析
14:33:40  ○  Brief Analyst · claude/sonnet                   完成 (85s)
14:33:42  ●  Mission Coordinator · claude/opus               正在合成...
14:33:45  ●  Expert 赛博禅心 · claude/opus                   Round 1 开始
14:33:45  ●  Expert 数字生命卡兹克 · codex/gpt-5              Round 1 开始
```

约定：
- **绿色 ● 实心圆**：该 agent 当前在线/运行中（`started` 事件到 `completed/failed` 之间）
- **灰色 ○ 空心圆**：该 agent 已完成/闲置
- **红色 ● 实心圆**：该 agent 失败

Agent 名 + `cli/model` 排版在同一行，便于一眼看出"当前 opus 在忙 / sonnet 在忙哪步"。**同一 agent 的多条事件在 UI 层聚合**：一个 agent 从 started → completed 只显示一行，右侧用状态点表示当前态；点进去可以看这个 agent 跑的全部子事件（开始/工具调用/完成）。

### 11.2.2 AgentStatusBar（新增组件，顶部活跃 agents）

Workbench 顶栏右侧新增一个紧凑 pill 条，显示**当前正在跑的所有 agent**（= 有 started 事件但还没对应 completed/failed 的）：

```
顶栏: [← 列表] [项目名] [状态] ... [活跃: ● 赛博禅心 opus · ● 卡兹克 codex]
```

- 绿色脉动圆点（CSS keyframes）
- 没有活跃 agent 时该条消失
- hover 每个 pill 显示当前 agent 在做什么（用最近一条 started 事件的 stage）

这个 bar 和 AgentTimeline 是互补的：AgentStatusBar 给"此刻正在干啥"的 glance，Timeline 给"全过程回放"。

### 11.3 OverviewIntakeForm 结构

```
上传 Brief 配图 [📎 拖拽 / 选文件]   (已上传 N 张，可删)
  └ 已有图片缩略图网格

上传产品截图 [📎 拖拽 / 选文件]   (已上传 M 张)
  └ 已有图片缩略图网格

产品文档 URL：
  [输入框]          [+ 添加]
  已添加：
    - https://pixverse.ai  [🗑]
    - https://docs...      [🗑]

补充描述（可选）：
  [textarea]

[生成产品概览] ← 主按钮
```

### 11.4 CaseListPanel 结构

```
6 个候选 Case（创意平均分 8.3）

☐ Case 01 — 多宫格分镜直出         by 卡兹克   [🎬 video]   创意 9
   why: 多宫格直出是 C1 主打但很少实测
   [展开详情]

☒ Case 02 — 打斗动作连贯性压测     by 卡尔     [🎬 video]   创意 8
   why: ...
   [展开详情]

☐ Case 03 ...

已选 2 / 4（上限）   [✓ 批准这些 Case]
```

### 11.5 CaseSelectedGuide（SP-03 终态）

- 顶部："Case Plan 已批准 ✅，下一步：**去跑真实测**"
- 每个选定 Case 一大卡：
  - 目标 / 步骤清单（可勾） / Prompts（可复制）/ 截图点 / 录屏点
- 底部："完成实测后，到 SP-04 Evidence 上传界面继续"（SP-03 阶段这个按钮 disabled，显示 "SP-04 未上线"）

## 12. 状态机（SP-03 新增）

```
mission_approved                   ← SP-02 终点
  ↓ (进入 SP-03)
awaiting_overview_input
  ↓ (overview/generate 触发)
overview_analyzing
  ↓ (agent 完成)
overview_ready
  ↓ (agent 失败 → overview_failed 可重跑)
  ↓ (overview/approve 批准)
awaiting_case_expert_selection
  ↓ (case-plan/start)
case_planning_running
  ↓ (round1+tool+round2 全部完成)
  ↓ (任一专家失败 → case_planning_failed 可重跑失败的)
case_synthesizing
  ↓ (coordinator done)
awaiting_case_selection
  ↓ (case-plan/select 批准)
case_plan_approved                 ← SP-03 终点
```

## 13. 验收标准

### 13.1 功能

1. 上传 5 张 Brief 配图 + 5 张产品截图 + 2 个 URL → Overview Agent 3-5 分钟内完成
2. Overview frontmatter 字段完整（§6.1 所有 key），正文 > 300 字
3. Case 专家选择器默认预选符合策略（Mission 已选 ∪ 创意 Top 3）
4. 至少一位专家的 round1 输出含 tool call → 真的 query refs.sqlite → round2 reflects 新证据
5. candidates.md 产出 ≥ 3 个 Case（去重后），每个 Case frontmatter 含 §6.3 所有必填字段
6. Case 里的 inspired_by 引用的 ref_path 在 vault 里真实存在
7. 用户选 2-4 个 Case → selected-cases.md 正确生成带引导 checklist
8. 图片删除功能能正确清理 context/images/ 同名文件
9. 端到端（overview → case 选定）整个流程 ≤ 20 分钟

### 13.2 鲁棒性

10. Overview Agent 失败（图太大、vision model 不可用）→ 状态进 `overview_failed`，可重跑
11. 任一 Case 专家失败 → 状态 `case_planning_failed`，其他专家结果保留，可单独重跑失败的
12. tool call 超时（crossing-kb search 卡住）→ fallback 为空结果，专家 round2 照跑
13. 用户在 overview_ready 编辑 markdown → 保留修改 → 重跑 Case 时读最新 overview

### 13.3 代码质量

14. `packages/agents` 新增 3 个角色 + tool-runner 都有单元测试
15. `packages/web-server` 新增 service + route 测试覆盖主路径 + 失败分支
16. `packages/web-ui` 核心组件（OverviewIntakeForm / CaseListPanel）有交互测试（testing-library）
17. 累计所有包 `pnpm test` 全绿

## 14. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| vision 模型对 UI 截图理解差，overview 瞎编 | Case 规划偏 | Overview human editing 是 1st-class（明确告知"Agent 可能误读，请直接改"）|
| 图片 token 贵 | 每次 overview 调用成本高 | 图片压缩到长边 1280 再喂给 model；overview 只做一次，case round 不再喂图 |
| tool loop 死循环 | 无止境查 refs | 硬 cap：**单专家只 1 轮工具 call**；如果 Round 2 又发 tool call 直接忽略 |
| inspiration pack 抽 prompt 正则失败 | 专家看不到历史 prompt 原文 | 抽不到就给 full summary + 前 2000 字，总有点东西 |
| Case 去重算法（Coordinator）粗 | 候选里 2 个 case 太像 | 首版让 Coordinator 靠 LLM 判断；设计 prompt 让它明确"角度差异 ≥ 0.5" |
| 创意 score 手标不准 | 默认预选不好 | 每次 Case 规划完给用户一个反馈按钮"这次选得对吗"→ 将来做数据反向校准 |
| 大量图片上传 + 项目堆积耗磁盘 | vault 膨胀 | 单项目上限 30 张；SP-04 Evidence 独立 quota |
| tool loop 让 Round 2 忘了 Round 1 context | 输出散 | Round 2 prompt 里明确粘贴 Round 1 原文作为 "你之前的草稿" |

## 15. 未来扩展（SP-03 不实施但预留）

- 多轮 tool loop（N=3-5 轮）——目前硬 cap 1 轮
- Overview Agent 自己爬 URL（Playwright）
- Case 之间依赖关系（Case 2 以 Case 1 产物为输入）
- Case A/B 变体（同一创意两种 prompt）
- 创意 score 用历史数据自动校准
- 图片 OCR 让 overview 能读到截图里的中文文字（需要 OCR 流程）

## 16. 实施顺序（交 writing-plans 细化）

预估 28-32 个 task，大约 2.5-3 周：

0. SSE 事件统一带 `cli/model` 字段（SP-02 已有事件回补 + 新事件格式）+ event-log.ts 签名扩展
1. ModelAdapter 扩展 images 参数（claude + codex 两边）
2. ImageStore service（upload/list/delete）
3. `POST /overview/images` multipart route
4. OverviewIntakeForm 图片上传 UI
5. URL fetch 复用 + user description 输入
6. ProductOverviewAgent role + vision prompt
7. OverviewAnalyzerService（接受 images + urls + desc → agent → md）
8. `POST /overview/generate` 触发 route
9. `GET/PATCH /overview` 读写 overview.md
10. `POST /overview/approve` 状态跃迁
11. ProductOverviewCard（可编辑 md 预览）
12. SectionAccordion 左侧改造
13. ExpertRegistry 加 creativity_score 字段
14. default_preselect 策略：Mission ∪ Top3 创意
15. CaseExpertSelector 组件
16. inspiration-pack-builder（正则抽 prompt/steps）
17. CasePlannerExpert role + round1/round2 prompt
18. CaseCoordinator role + prompt
19. case-expert-runner（tool loop 实现）
20. CasePlanOrchestrator（编排 round1 → tool → round2 → coord）
21. `POST /case-plan/start` + `GET /case-plan/candidates`
22. CaseListPanel（多选 + 展开 CaseCardPreview）
23. `POST /case-plan/select` + selected-cases.md 生成
24. CaseSelectedGuide（SP-03 终态引导）
25. SSE 新事件类型订阅（含 cli/model 消费）
26. AgentTimeline 改造：行内展示 agent·cli/model + 状态点（green/gray/red），同 agent 事件 UI 层聚合
27. AgentStatusBar 顶栏活跃 agents pill 条（绿色脉动圆点 + hover 当前阶段）
28. 更新 ProjectWorkbench 状态切换逻辑
29. 集成测试：mock agents 端到端 overview → case 批准
30. 真机 smoke：用 MetaNovas 项目（SP-02 smoke 产出）继续走 SP-03

## 17. 验收与交付

- 代码位于 `packages/agents/` + `packages/web-server/` + `packages/web-ui/`
- Vault 更新 `08_experts/topic-panel/index.yaml` 加 creativity_score
- 启动：`pnpm dev`，承接 SP-02 已有项目无缝进入 SP-03 阶段
- spec 通过后调用 `writing-plans` 产出实施计划
