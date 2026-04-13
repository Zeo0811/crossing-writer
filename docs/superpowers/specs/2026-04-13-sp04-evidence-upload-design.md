# SP-04 Evidence Upload 设计稿

**日期：** 2026-04-13
**前置：** SP-03 完成（`case_plan_approved` 状态 + `selected-cases.md` + 实测 checklist）；SP-03.5 完成（ActionButton / Toast / SseHealthDot / SectionStatusBadge / ConfigStore / SettingsDrawer）
**目标：** 离线实测后，把过程截图 / 录屏 / 产品产出 / 观察笔记归档到 vault，为 SP-05 Writer 提供可机读的原始依据
**范围：** 纯本地存储 + 一组 evidence 路由 + 左栏新增 Evidence Section + 右栏上传表单，不动 agent/orchestrator 逻辑
**非目标：** Writer agent（SP-05）、视频预览播放器、OCR/ASR、跨 case 复用、上传锁定

---

## 1. 背景

SP-03 终点：用户拿到 `mission/case-plan/selected-cases.md`（2-4 个选中的 Case + 实测 checklist）。用户**离线**去跑每个 case（在被测产品上实际操作），产出多种形态的素材：

- 过程截图（产品 UI 界面）
- 操作录屏（完整流程）
- 产品生成物（图/gif/视频/音频/文本 —— 依产品形态而变）
- 主观观察笔记 + 量化数据

SP-04 要做的是：把这些素材**按 case 归档**，让 SP-05 的 Writer agent 能取到机读的索引 + 原始文件（包括 vision 读取截图）来写出有事实依据的测评文章。

## 2. 架构总览

**纯前端 + 一组 evidence 路由 + 2 个新状态。** 复用 SP-03.5 的 ActionButton/Toast/SectionStatusBadge/SSE，不引入新依赖。

### 2.1 文件系统布局

每个项目：

```
~/CrossingVault/07_projects/<project-id>/evidence/
├── index.md                        ← 自动生成的总索引
├── case-01/                        ← case_id 对应 selected-cases.md
│   ├── screenshots/                ← 过程截图
│   │   ├── 001-topology.png
│   │   └── 002-error-popup.png
│   ├── recordings/                 ← 操作录屏
│   │   └── full-run.mp4
│   ├── generated/                  ← 产品产出物（图/视频/音频/文本）
│   │   ├── agent-output.md
│   │   ├── result-video.mp4
│   │   └── cover.gif
│   └── notes.md                    ← frontmatter + 自由笔记
├── case-02/ ...
└── case-03/ ...
```

- `case-NN` 目录在"提交 selected-cases"后预建（`screenshots/` / `recordings/` / `generated/` 三个子目录一起建；`notes.md` 不预建，首次保存时创建）。
- 文件名保留原文件名 + 冲突自动加 `-2` / `-3` 后缀，不重命名为 `shot-N.png`（给用户保留命名语义）。

### 2.2 新增文件

```
packages/web-ui/src/
├── components/evidence/
│   ├── EvidenceSection.tsx          — 左栏：per-case 进度卡片列表 + 提交按钮
│   ├── EvidenceIntakeForm.tsx       — 右栏：选中 case 的上传表单容器
│   ├── ScreenshotUploader.tsx       — 拖拽 + 列表（.png/.jpg/.webp，≤10MB）
│   ├── MediaUploader.tsx            — 拖拽 + 列表（generated 通吃型，≤200MB）
│   ├── RecordingUploader.tsx        — 拖拽 + 列表（.mp4/.mov/.webm，≤100MB）
│   ├── NotesEditor.tsx              — frontmatter 表单 + observations 动态列表 + 自由笔记
│   └── CaseCompletenessBadge.tsx    — ✅/⚠️/灰 三态徽章
├── hooks/
│   ├── useEvidence.ts               — per-case CRUD 订阅 SSE
│   └── useProjectEvidence.ts        — project-wide 进度订阅
└── api/evidence-client.ts

packages/web-server/src/
├── services/
│   ├── evidence-store.ts            — 文件归档 / 冲突 rename / index 生成
│   └── evidence-completeness.ts     — 纯函数：输入 case 状态 → {complete, missing}
└── routes/evidence.ts
```

### 2.3 修改已有

```
packages/web-server/src/
├── state/state-machine.ts           — 加 evidence_collecting / evidence_ready + 转换
├── services/project-store.ts        — Project.evidence 字段
└── server.ts                        — 挂载 evidence 路由 + multipart limit 放到 1.5GB

packages/web-ui/src/
├── pages/ProjectWorkbench.tsx       — 左栏 accordion 加 Evidence section；右栏分支
├── components/status/SectionStatusBadge.tsx — SECTION_ORDER 加 evidence 组
└── hooks/useProjectStream.ts        — EVENT_TYPES 加 evidence.updated / evidence.submitted
```

## 3. 数据模型

### 3.1 `notes.md` schema

```yaml
---
type: evidence_notes
case_id: case-01
ran_at: 2026-04-14T10:30:00Z        # 实测时间戳
duration_min: 45                     # 跑完花了多久
quantitative:
  rework_count: 2
  total_steps: 6
  completed_steps: 6
  avg_step_time_min: 8
  total_tokens: 15000                # 可选
  custom:
    editor_score: 7.5                # 任意 k/v
observations:
  - point: "断点发生时系统无提示"
    screenshot_ref: screenshots/002-error-popup.png   # 可选
    generated_ref: null
    severity: major                  # major | minor | positive
  - point: "模板复用一键成功"
    severity: positive
---

# 自由笔记

（markdown 正文，长格式主观感受）
```

**校验（后端 PUT /notes 时执行）：**
- `type === "evidence_notes"` 必须
- `case_id` 必须 match URL param
- `ran_at` 可选 ISO 8601 字符串
- `duration_min` 可选正整数
- `quantitative.*` 可选，内部值必须是 number
- `observations[]` 可选，每条 `point` 非空、`severity ∈ {"major","minor","positive"}`、`screenshot_ref`/`generated_ref` 可选字符串

**parser：** 手写 `---\n...\n---\n<body>` split + `yaml.load`（js-yaml 已在 @crossing/kb 间接依赖，无新增）。

### 3.2 `evidence/index.md` schema

```yaml
---
type: evidence_index
project_id: metanovas-sp-02-smoke
updated_at: 2026-04-14T11:00:00Z
cases:
  - case_id: case-01
    name: "一条小红书图文的接力赛"
    completeness:
      has_screenshot: true
      has_notes: true
      has_generated: true
      complete: true
      missing: []
    counts:
      screenshots: 2
      recordings: 1
      generated: 3
    total_bytes: 45678912
    notes_path: case-01/notes.md
---

# Evidence Index

## Case 01 — 一条小红书图文的接力赛 ✅
- 2 张过程截图
- 1 段录屏
- 3 份产出（1 文本 + 2 图）
- notes.md: 2 个 observation，45min，返工 2 次

## Case 02 — 返工地狱模拟器 ⚠️ 缺产出
...
```

每次任何文件 CRUD 或 notes 保存都重生成。

### 3.3 `Project.evidence` 字段

```ts
evidence?: {
  cases: Record<string, {
    has_screenshot: boolean;
    has_notes: boolean;
    has_generated: boolean;
    complete: boolean;
    counts: { screenshots: number; recordings: number; generated: number };
    last_updated_at: string;
  }>;
  index_path: string;              // "evidence/index.md"
  all_complete: boolean;
  submitted_at: string | null;
};
```

## 4. Completeness 规则

一个 case 算"完整"的最低条件（3 个都要）：

1. `screenshots/` 下 ≥ 1 个文件
2. `notes.md` 存在，frontmatter 合法，且 body（自由笔记）或 observations 至少一者非空
3. `generated/` 下 ≥ 1 个文件

对应 `evidence-completeness.ts`：

```ts
export interface CompletenessResult {
  complete: boolean;
  missing: Array<"screenshot" | "notes" | "generated">;
  has_screenshot: boolean;
  has_notes: boolean;
  has_generated: boolean;
}

export function computeCompleteness(caseDir: string): CompletenessResult;
```

纯函数，单元测试 5 场景覆盖。

## 5. 后端 API

| Method | Path | 语义 |
|---|---|---|
| GET | `/api/projects/:id/evidence` | 项目级概览（返回 Project.evidence 全量） |
| GET | `/api/projects/:id/evidence/:caseId` | 单 case 详情（3 类文件列表 + notes） |
| POST | `/api/projects/:id/evidence/:caseId/files` | 上传文件（multipart；field `kind` + `file`） |
| DELETE | `/api/projects/:id/evidence/:caseId/files/:kind/:filename` | 删除单文件 |
| GET | `/api/projects/:id/evidence/:caseId/notes` | 读 notes.md |
| PUT | `/api/projects/:id/evidence/:caseId/notes` | 写 notes.md（JSON body） |
| POST | `/api/projects/:id/evidence/submit` | 提交（全 complete 才过）→ 转 evidence_ready |

### 5.1 Size 限制

- screenshot: 10 MB / 张
- recording: 100 MB / 条
- generated: 200 MB / 个
- 单 case 总量: 1 GB
- 超限：413（单文件）/ 409（总量超）

### 5.2 SSE events（新增）

- `evidence.updated` `{case_id, action, completeness}` — 每次 CRUD
- `evidence.submitted` `{project_id, submitted_at}` — 提交成功

加入 `useProjectStream` EVENT_TYPES 白名单。

## 6. 状态机扩展

在 `state-machine.ts` 的 ProjectStatus 加：`evidence_collecting` | `evidence_ready`。

TRANSITIONS：

```
case_plan_approved → [evidence_collecting]
evidence_collecting → [evidence_ready]
evidence_ready → [evidence_collecting]      // 允许回溯
```

**进入 `evidence_collecting` 的触发：** 首次访问 `/api/projects/:id/evidence`（GET 总览）时，后端 lazy 转（如当前是 `case_plan_approved`）。不引入单独的 `/start` 端点。

## 7. 前端 UI 布局

### 7.1 左栏 Accordion

SP-03 已有 4 个 section（Brief / Mission / 产品概览 / Case 列表），SP-04 加第 5 个：

```
Evidence   [N/M 完整 🟢]
```

badge 计数 = 已 complete 的 case 数 / selected case 总数。

展开后：`<EvidenceSection>` —— per-case 进度卡片列表 + 底部"提交 Evidence"按钮：

```
[Case 01 — 一条小红书图文的接力赛]  [✅ 完整]
  2 截图 · 1 录屏 · 3 产出 · 笔记 ✓
[Case 02 — 返工地狱模拟器]          [⚠️ 缺产出]
  2 截图 · 0 录屏 · 0 产出 · 笔记 ✓
[Case 03 — 同一工作流的双语碰撞]    [待上传]
  未开始
─────────────────────────
进度：2/3 完整
[提交 Evidence]  ← 3/3 完整才 enabled（ActionButton）
```

点击卡片 → 右栏切换到该 case。

已提交（`evidence_ready`）后：卡片转灰描边；提交按钮变 disabled + tooltip "已提交"；用户仍可点卡片修改（修改后状态回到 `evidence_collecting`）。

### 7.2 右栏 EvidenceIntakeForm

**头部：** `Case 01 — 一条小红书图文的接力赛 [✅ 完整]`，可折叠展开 case 原始 steps/observation_points 作为"你记得跑哪些"的提醒。

**主体**（3 个 uploader + 1 个 notes editor）：

- **ScreenshotUploader**：拖拽区（`accept="image/png,image/jpeg,image/webp"`）+ 已上传列表（缩略图 + 文件名 + size + `[×]`）
- **RecordingUploader**：拖拽区（`accept="video/mp4,video/quicktime,video/webm"`）+ 列表（文件名 + size + `[×]`，不预览）
- **MediaUploader**（generated）：拖拽区（不限 accept，但后端校验）+ 列表
- **NotesEditor**：
  - 量化数据表单：`ran_at` / `duration_min` / `rework_count` / `total_steps` / `completed_steps` / `avg_step_time_min` / `total_tokens` + 自定义 k/v
  - Observations 动态列表：每行 `point` textarea + `severity` 下拉 + "关联截图"下拉（从已上传列表选）+ "关联产出"下拉 + `[删]`
  - 自由笔记 textarea
  - 底部 `[保存笔记]`（ActionButton）

**交互：**
- 拖拽：hover 高亮 + drop 并行 POST 每个文件；失败文件单独 toast；成功后 useEvidence 订阅的 SSE 自动刷新列表
- 删除：确认弹窗（`window.confirm`）+ DELETE；成功后列表和完整度自动刷新
- 保存笔记：PUT → toast "已保存"；失败显示 error echo
- 关联下拉实时反映已上传文件名

### 7.3 CaseCompletenessBadge（独立组件）

输入 `completeness: CompletenessResult`，输出：
- `complete=true` → 绿底 `✅ 完整`
- `complete=false && has_something` → 黄底 `⚠️ 缺 {screenshot→截图|notes→笔记|generated→产出}`
- 全空 → 灰底 `待上传`

## 8. 错误处理

- **上传失败**（413 / 409 / 500）：Toast + 文件条目保留但标红，允许重试或删除
- **notes schema 400**：后端返 `{error: "field X invalid: reason"}`，前端显示在保存按钮下方红字
- **提交失败 409**：Toast 列出 `incomplete_cases`，左栏对应卡片闪红一次
- **SSE 断开**：已有 SseHealthDot 显示
- **删除失败 404**：静默刷新（文件可能已被另一端删除）

## 9. 测试策略

新增约 30-40 tests。保持 SP-03 的 196 全部不回归。

| 模块 | 类型 | 用例 |
|---|---|---|
| `evidence-completeness.ts` | unit | 5 场景（全空/只截图/只笔记/只产出/全齐） |
| `evidence-store.ts` | unit | save 不覆盖（冲突 rename）/ delete / notes read-write / index 自动重生 |
| GET `/evidence` | route | 200 返 Project.evidence / lazy 转状态 |
| GET `/evidence/:caseId` | route | 列文件 / 404 未知 case |
| POST `/evidence/:caseId/files` | route | 3 kind / 413 单文件超 / 409 总量超 |
| DELETE `/evidence/:caseId/files/:kind/:filename` | route | 204 / 404 / 触发 index 重生 |
| GET/PUT `/notes` | route | schema 校验 / 400 |
| POST `/submit` | route | 409 incomplete / 200 + 状态转 |
| SSE broadcast | route | 上传后推送 evidence.updated |
| `EvidenceSection` | component | 卡片渲染 / click 选中 / submit 按钮逻辑 |
| `EvidenceIntakeForm` | component | 上传流 / 删除流 / notes 保存 |
| `CaseCompletenessBadge` | component | 4 态 |
| `NotesEditor` | component | observation 增删改 / PUT 触发 |
| `useEvidence` hook | component | SSE 订阅刷新 |
| e2e | route | case_plan_approved → 访问 → 传 3 文件 → 写笔记 → 提交 → evidence_ready |

## 10. 估算

2-3 天工作量，14-16 个 TDD task：

| 里程碑 | tasks | 内容 |
|---|---|---|
| M1 后端基础 | 3 | evidence-store + completeness + 状态机 |
| M2 后端路由 | 5 | GET/POST/DELETE/notes/submit |
| M3 前端 api+hook | 2 | evidence-client + 2 hooks |
| M4 前端组件 | 4 | badge / notes editor / intake form / section |
| M5 集成 | 2 | ProjectWorkbench 接入 + e2e |
| M6 smoke | 1 | 人工 MetaNovas 全流程 |

---

## 11. 推后做的（Future Work）

本期明确不做，记录在此，SP-04 收尾后按优先级排入 SP-04.5 或后续：

### 11.1 视频/录屏预览与抽帧
- 当前：上传后只显示文件名 + size，播放靠系统默认 app
- 推后：内嵌 `<video>` 预览；自动抽第 1 / 中 / 末帧截图给 vision-capable Writer 当输入
- 原因：抽帧需 ffmpeg 依赖，链路变重；本期 Writer 可先只读文本/静图

### 11.2 音频转写
- 当前：音频作为 `generated/*.mp3` 文件存，Writer 无法"听"
- 推后：调本地 whisper.cpp 或云 ASR 转 text，存 `generated/<file>.transcript.md` 伴生
- 原因：非测评文章核心场景，ROI 不高

### 11.3 截图 OCR
- 当前：截图只走 vision（claude `@path`）
- 推后：每张截图跑 tesseract/本地 OCR 存 `screenshots/<file>.ocr.txt` 伴生
- 原因：claude vision 本身对文字识别已经不错，暂不必

### 11.4 上传进度条
- 当前：ActionButton spinner
- 推后：大文件（>50MB）用 `XHR.upload.onprogress` 显示百分比
- 原因：本地上传足够快，网络限速场景少

### 11.5 跨 case 复用 evidence
- 当前：同一张截图两个 case 都要用 → 上传两次
- 推后：引入 shared bin 或符号链接
- 原因：多数情况 case 独立，不值得引入引用复杂度

### 11.6 Evidence 版本/历史
- 当前：重名 rename（foo.png / foo-2.png）留多版本但无关系记录
- 推后：真版本标记（`foo@v1.png`），前端展示历史切换
- 原因：一次性测评场景少见重跑

### 11.7 导出 evidence 包
- 当前：vault 里散文件，要分享给他人要自己 tar
- 推后：一键导出 `project-evidence-<timestamp>.zip`（含 notes + 索引 + 原文件）
- 原因：单人工作流，暂不需要分享

### 11.8 外部系统集成
- 当前：只接受本地文件上传
- 推后：从 Notion / 飞书 / Google Drive 拉 evidence；从 Slack 消息截图抓
- 原因：核心流程走通再考虑外部入口

### 11.9 自动 dedup
- 当前：用户可能误传两张相同截图
- 推后：后端对比 md5，重复直接拒绝 + 提示
- 原因：edge case，手动删即可

### 11.10 Evidence 模板推荐
- 当前：用户按 case 自己判断要录什么
- 推后：基于 case 的 observation_points / screenshot_points 自动生成 checklist，上传时勾选
- 原因：case 里已有这些字段，Writer 阶段再用更好

### 11.11 权限 / 多人协作
- 当前：单机单人
- 推后：用户登录、per project 权限、审阅制
- 原因：远期功能，SaaS 化时才需要

---

## 12. 交付物

1. 本 spec 提交 git
2. 实施计划 `docs/superpowers/plans/2026-04-13-sp04-evidence-upload.md`
3. 14-16 个 TDD task
4. 完成后人工 smoke：选 MetaNovas 的 2-3 个 case，完整走一遍上传流程
5. 把 Future Work 条目 7-11 之中若本期发现有必做的，挪到 SP-04.5 待办
