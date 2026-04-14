# SP-18 Project Health Checklist — Design Spec

**Date**: 2026-04-18
**Status**: Draft
**Owner**: Writer Platform

---

## 1. 动机

`ProjectWorkbench.tsx` 把一个项目拆成了 6 个主步骤（Brief / 选题 / 案例策划 / 素材 / 初稿 / 精修），每个步骤都对应独立的子任务与产物。目前的问题：

- **看不清进度**：用户切回一个老项目时，没有「我走到哪一步、漏了什么」的一眼概览，必须逐个 Tab 点进去确认。
- **Writer 被静默拦截**：SP-10 引入了 `run.blocked` 机制，当 `writer.*` agent 缺少 styleBinding 时拒绝运行。但这个 blocker 只在点击「运行 Writer」时才弹出 —— 用户之前完全没有感知。
- **其他步骤零可见性**：除了 styleBinding，诸如「brief 没上传」「case plan 还是 draft 状态」等同样会阻塞产出，但没有任何统一的提示。

本 spec 在 `ProjectWorkbench` 顶部引入一条 **Project Health Checklist** 长条：把 7 个关键 step 的完成状态 + blocker 做成 chip 阵列，一眼看清、点击跳转、阻塞有理由。

---

## 2. 核心概念

### 2.1 `ProjectChecklist`

一个项目对应一份 checklist，由一个有序的 step 列表组成：

```ts
type ChecklistStatus = "done" | "partial" | "blocked" | "todo" | "warning";

interface ChecklistItem {
  step: ChecklistStepId;     // 固定枚举，见 2.2
  status: ChecklistStatus;
  reason?: string;           // 非 done 时的人话解释
  link?: string;             // 前端锚点 / tab key
}

interface ProjectChecklist {
  projectId: string;
  items: ChecklistItem[];
  generatedAt: string;       // ISO timestamp
}
```

### 2.2 状态语义

| status    | 图标 | 含义                                                       |
|-----------|------|------------------------------------------------------------|
| `done`    | ●    | 步骤完全达成                                               |
| `partial` | ◐    | 部分完成（比如 3 个 section 里 2 个有初稿）                |
| `todo`    | ○    | 还没开始                                                   |
| `warning` | ▣    | 可继续，但建议关注（比如评审还没跑过，非强制）             |
| `blocked` | ◉    | 下游动作被它挡住（SP-10 的 `run.blocked` 直接映射到这里）  |

---

## 3. 7 个 Step Items

> 顺序与 UI 从左到右保持一致。

1. **`brief`** — brief 上传并解析完成
   - done: `project.status ∈ {brief_analyzed, topic_selected, case_finalized, drafting, reviewing, done}`
   - todo: `project.status === "created"` 或未上传 brief
   - warning: 上传了但解析失败

2. **`topic`** — 至少有一个选题被定稿
   - done: `project.topic_decision.selected` 存在且非空
   - partial: 有候选但未定稿
   - todo: 未进入选题阶段

3. **`case`** — 案例策划定稿
   - done: `project.case_plan.status === "finalized"`
   - partial: `case_plan.status === "draft"`
   - todo: 无 case_plan

4. **`evidence`** — 素材齐全或显式跳过
   - done: `evidence_store` 非空 **或** `project.flags.evidence_skipped === true`
   - todo: 既无素材也未跳过

5. **`styleBindings`** — 三个 writer.* agent 都有活跃 styleBinding
   - done: SP-10 的 resolver 对 `writer.opening / writer.practice / writer.closing` 三者都返回 `{ ok: true }`
   - blocked: 任一返回 `{ ok: false, reason }` → `status: blocked`，`reason` 直接取 resolver 返回值
   - 与 writer run 的 `run.blocked` 同源，保证一致

6. **`draft`** — 所有 section 都有初稿
   - done: `article-store` 下 `opening.md / practice.md / closing.md` 三个文件都存在且非空
   - partial: 有 1–2 个
   - todo: 一个都没

7. **`review`** — style-critic 跑过 或 用户标记 OK（MVP 为非强制）
   - done: `project.review.passed === true` 或存在 `style_critic_report.json`
   - warning: draft 全有但 review 没跑（不挡后续，仅提醒）
   - todo: draft 还没齐，review 提前不展示 warning，降级为 todo

---

## 4. 架构

### 4.1 后端

**新路由**: `GET /api/projects/:id/checklist`

```ts
// returns 200
{
  projectId: "p_xxx",
  items: ChecklistItem[],
  generatedAt: "2026-04-18T06:12:00Z"
}
```

**新服务**: `ProjectChecklistService`

职责：
- 读取 `project.json`（status / topic_decision / case_plan / flags / review）
- 读取 `article-store` 判断 draft 文件
- 调 SP-10 的 `resolveStyleBinding(agentId, projectId)` 判断 writer.* 绑定
- 按 2.2 语义聚合返回

每次请求实时计算，不缓存（项目体量小，一次 I/O 即可；后续若热点可加 per-project memoize，不在本 spec 范围）。

### 4.2 前端

**组件**: `ProjectChecklist.tsx`

- 挂在 `ProjectWorkbench.tsx` 最顶部，位于 tab bar 上方。
- 样式：水平 chip 行，左侧图标 + 步骤名（中文短 label），hover 出 tooltip 显示 `reason`。
- 点击行为：根据 `item.link` 切到对应 tab（通过 `ProjectWorkbench` 已有的 tab router）。
- 数据获取：`useProjectChecklist(projectId)` hook，基于 React Query，`staleTime: 30s`，在 tab 切换/项目字段变更后 invalidate。

**交互细节**：
- `blocked` chip 使用警示色（红/橙），`warning` 使用琥珀，`done` 灰调不抢焦。
- 整条长条右端放一个「折叠」按钮，状态存 `localStorage[`checklist.collapsed.${projectId}`]`；折叠时只留一个小圆点提示总览（done 数 / 总数）。

### 4.3 可选关闭

- 折叠 → 本地持久化，按项目维度
- 不提供全局关闭（避免新用户永远看不到）

---

## 5. API 契约

### Request

```
GET /api/projects/:id/checklist
```

### Response 200

```jsonc
{
  "projectId": "p_2026_04_18_xxx",
  "generatedAt": "2026-04-18T06:12:00.123Z",
  "items": [
    { "step": "brief",         "status": "done",    "link": "brief" },
    { "step": "topic",         "status": "done",    "link": "topic" },
    { "step": "case",          "status": "partial", "reason": "案例策划仍为 draft 状态", "link": "case" },
    { "step": "evidence",      "status": "todo",    "reason": "尚未上传素材，也未标记「不需要」", "link": "evidence" },
    { "step": "styleBindings", "status": "blocked", "reason": "writer.practice 缺少 styleBinding（SP-10）", "link": "config" },
    { "step": "draft",         "status": "todo",    "link": "draft" },
    { "step": "review",        "status": "todo",    "link": "review" }
  ]
}
```

### Response 404

项目不存在 → 标准 `{ error: "project_not_found" }`。

---

## 6. 验收标准

- [ ] 新项目（刚创建）：7 个 step 全为 `todo`，`brief` chip 高亮提示「先上传 brief」
- [ ] brief 上传并解析后：`brief` → `done`，其余保持 `todo`
- [ ] case plan 仅 draft：`case` → `partial`，tooltip 显示「draft 状态」
- [ ] 删除某 writer.* agent 的 styleBinding：`styleBindings` → `blocked`，reason 与 SP-10 resolver 返回一致
- [ ] article-store 只有 `opening.md`：`draft` → `partial`
- [ ] 点击任一 chip 正确切到 `ProjectWorkbench` 对应 tab
- [ ] 折叠后刷新页面，折叠状态保持（localStorage per projectId）
- [ ] `GET /api/projects/:id/checklist` 响应时间 p95 < 200ms（本地 I/O）

---

## 7. 不在本 spec 范围

- 自定义 step 顺序 / 增减 step（目前写死 7 项）
- 进度百分比进度条 / 甘特图
- 跨项目的 health dashboard（多项目聚合视图）
- 自动修复动作（「一键补 styleBinding」之类的 quick fix 按钮）
- Checklist 历史轨迹 / 审计

---

## 8. 关联

- SP-02 Mission Workbench（`ProjectWorkbench` 主体）
- SP-03 Case Plan Workbench（`case_plan.status` 字段来源）
- SP-04 Evidence Upload（evidence_store + `evidence_skipped` flag）
- SP-05 Writer（draft 产物 article-store）
- SP-10 Config Workbench（styleBinding resolver，blocked 状态直通）
