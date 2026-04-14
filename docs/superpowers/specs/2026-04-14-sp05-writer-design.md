# SP-05 Writer 设计稿

**日期：** 2026-04-14
**前置：** SP-04 完成（evidence_ready 状态 + `vault/article/` 空目录 + 各 case evidence 归档）
**目标：** 读前序所有产出（brief/mission/overview/selected-cases/evidence），生成一篇十字路口风格测评文章首稿，支持人工 + @agent 交互修订到终稿
**范围：** 5 类 writer agent + orchestrator + 分段存储 + 整篇编辑器 + 段落 @agent 重写
**非目标：** 账号细致蒸馏 pipeline（SP-06）、任意范围 rewrite / 评论式 rewrite、多版本历史、飞书/公众号发布、多人协作

---

## 1. 背景

SP-04 终点：`evidence_ready`，vault 里每个 case 都有 screenshots / recordings / generated / notes.md。SP-05 要把这一堆原始素材 + 前序所有 SP 的产出，变成一篇结构清晰、风格一致、事实准确的十字路口公众号测评文章初稿，并让用户在编辑器里反复修订直到满意。

十字路口写作流在现实里本就是分段创作——钩子开头 / 实测主体 / 收束结尾，而且这三段承接不同的写作技巧和风格。SP-05 把这种分段映射为独立 agent，每个 agent 可独立选 cli/model 和参考账号，用户可以为每段找不同调性的"风格老师"。

## 2. 架构 Pipeline

```
evidence_ready
  → 用户进入 WriterConfigForm（右栏）
  → 选参考账号 + cli/model → 点「开始写作」
  ↓
writing_running
  ┌─ writer.opening（参考账号 A）         ─┐
  ├─ writer.practice.case-01（参考账号 B） ─┤
  ├─ writer.practice.case-02（参考账号 B） ─┼─ 并行
  ├─ writer.practice.case-NN              ─┤
  └─                                      ─┘
       ↓（全部完成）
    practice.stitcher（补 case 间过渡段）
       ↓
    writer.closing（读开头 + 实测拼好版本）
       ↓
    style_critic（读整篇 → 直接重写统一风格 → 分段回写各自文件）
       ↓
writing_ready（可编辑状态，UI 展示整篇编辑器）
  ↕
writing_editing（某段 @agent rewrite 进行中）
```

**设计选择记录：**
- 开头与 practice 并行，结尾串行（承接性需要）→ 折中方案 C
- practice 按 case 并行 + stitcher 补承接 → 方案 C
- style_critic 首稿后直接重写统一（不走批注）→ 用户信任写作 agent 本身已蒸馏风格
- 交互 rewrite 粒度：整段 → A；任意范围 / 评论式留作 Future Work

## 3. 文件布局

```
vault/07_projects/<id>/article/
├─ sections/
│  ├─ opening.md                    # 开头段
│  ├─ practice/
│  │  ├─ case-01.md                 # 每个 case 的实测小节
│  │  ├─ case-02.md
│  │  ├─ case-NN.md
│  │  └─ transitions.md             # stitcher 产物：case 之间 1-2 句过渡
│  └─ closing.md                    # 结尾段
├─ final.md                         # 自动合并，只读预览；顶层 frontmatter
└─ meta.json                        # { last_full_run_at, reference_accounts_per_agent, cli_model_per_agent }
```

每个 section 文件自带 frontmatter：

```yaml
---
section: opening                    # opening | practice.case-01 | closing | transitions
last_agent: writer.opening          # 最后写入者（agent key 或 "human"）
last_updated_at: 2026-04-14T15:00:00Z
reference_accounts: [topic_expert.赛博禅心]
cli: claude
model: opus
---

# 开头正文…
```

### final.md 合并规则

- 顶层 frontmatter：`{ type: "article_draft", project_id, produced_at, article_type, product_name, reference_accounts_summary }`
- 正文顺序：`opening` → `practice/case-01` → `transitions[case-01→case-02]` → `practice/case-02` → … → `closing`
- 每次任一 section 保存时自动重生 final.md

### 整篇编辑器内部表示

整篇编辑器把所有 section 拼接为单一 markdown，用 HTML 注释 marker 分隔：

```markdown
<!-- section:opening -->
# 开头正文…

<!-- section:practice.case-01 -->
## Case 1 …

<!-- section:transition.case-01-to-case-02 -->
（过渡 1-2 句）

<!-- section:practice.case-02 -->
## Case 2 …

<!-- section:closing -->
# 结尾…
```

保存时按 marker 切回 sections/*.md。markdown 渲染器会忽略 HTML 注释，不影响显示。

**Marker 丢失 fallback：** 先按 H1/H2 + 段名匹配恢复；仍失败则前端展示 warning "边界丢失，请手动保存为整篇并重建结构"，避免默默丢数据。

## 4. 状态机扩展

在 `packages/web-server/src/state/state-machine.ts` ProjectStatus 新增：

```
writing_configuring
writing_running
writing_ready
writing_editing
writing_failed
```

TRANSITIONS：

```
evidence_ready → writing_configuring          (lazy：首次 GET /writer/sections 时转)
writing_configuring → writing_running         (POST /writer/start)
writing_running → writing_ready               (orchestrator 全部完成)
writing_running → writing_failed              (任一段失败)
writing_failed → writing_running              (POST /writer/retry-failed)
writing_ready ↔ writing_editing               (开始 / 完成 rewrite 时切换)
writing_ready → evidence_collecting           (允许回 SP-04 重录)
```

## 5. Agents & Prompts

新增 5 类 agent（`packages/agents/src/roles/` + `packages/agents/src/prompts/`）：

| agent key | prompt 文件 | 输入 | 输出 |
|---|---|---|---|
| `writer.opening` | `writer-opening.md` | brief 摘要 + mission + product_overview + 参考账号 kb 检索 | 开头段 md |
| `writer.practice.case-NN` | `writer-practice.md`（共享） | 该 case 的 evidence（screenshots vision + notes + selected-cases 中该 case 描述） + 参考账号 kb | 该 case 实测小节 md |
| `practice.stitcher` | `practice-stitcher.md` | 所有 practice case 的首尾各 2-3 句 | 各 case 之间 1-2 句过渡（map: case-N → 过渡文本） |
| `writer.closing` | `writer-closing.md` | 开头 + 所有 practice（含 transitions）拼接版 | 结尾段 md |
| `style_critic` | `style-critic.md` | 首拼完的整篇 + 参考账号 kb | 分段重写版（map: section_key → new md） |

**实现规则：**
- 所有 agent 用已有 `invokeAgent()` 和 `ConfigStore.get(agentKey)` 读 cli/model
- 参考账号通过 crossing-kb 的 RAG 检索注入 prompt（复用 SP-02 topic_expert 接入 kb 的那套）
- `writer.practice.*` 的 config 读 `writer.practice`（不 per-case），per-case 只是并发实例
- vision：evidence 里的 screenshots 以 `@path` 形式附在 user message，交给 claude vision
- `style_critic` 只输出"与原稿不一致的段落"及其新内容，未修改段落原样保留

## 6. ConfigStore 扩展

`config.json` 的 `agents.*` 新增可选 `reference_accounts: string[]`：

```json
{
  "agents": {
    "writer.opening":    { "cli": "claude", "model": "opus",   "reference_accounts": [] },
    "writer.practice":   { "cli": "claude", "model": "sonnet", "reference_accounts": [] },
    "writer.closing":    { "cli": "claude", "model": "opus",   "reference_accounts": [] },
    "practice.stitcher": { "cli": "claude", "model": "haiku" },
    "style_critic":      { "cli": "claude", "model": "opus",   "reference_accounts": [] }
  }
}
```

- `reference_accounts` 元素 = `~/CrossingVault/08_experts/style-panel/` 下的文件名（去 `.md` 后缀）。每个 `.md` 文件代表一个参考账号的风格素材库（文件内容 = 该账号历史代表文章拼接或摘要，供 RAG 检索）
- 新增端点 `GET /api/kb/style-panels` 列举该目录下所有 `.md` 文件 → `[{ id, path, last_updated_at }]`
- `practice.stitcher` 不吃参考账号（只补过渡，不需要风格）
- **Per-project override**：`POST /writer/start` body 里的 `reference_accounts_per_agent` / `cli_model_per_agent` 写入 `project.writer_config`，orchestrator 优先读项目级配置，回退到 ConfigStore 全局
- SettingsDrawer **不加** 参考账号 UI（账号选择只在 WriterConfigForm），避免两处配置的心智负担

## 7. 后端 API

| Method | Path | 语义 |
|---|---|---|
| POST | `/api/projects/:id/writer/start` | body: `{ cli_model_per_agent, reference_accounts_per_agent }`；evidence_ready → writing_configuring → writing_running，派发 orchestrator |
| GET | `/api/projects/:id/writer/sections` | 列出所有 section（key + frontmatter + 前 200 字 preview） |
| GET | `/api/projects/:id/writer/sections/:key` | 单段完整内容（含 frontmatter） |
| PUT | `/api/projects/:id/writer/sections/:key` | 人工保存单段（body: `{ body: md }`）；更新 last_agent=human |
| POST | `/api/projects/:id/writer/sections/:key/rewrite` | @agent 重写（body: `{ user_hint?: string }`），SSE 流式推送 chunk；完成后写回文件 |
| GET | `/api/projects/:id/writer/final` | 合并后 final.md 原文 |
| POST | `/api/projects/:id/writer/retry-failed` | 只重跑 writing_failed 记录的失败段 |
| GET | `/api/kb/style-panels` | 列举 `08_experts/style-panel/*.md` → 候选参考账号 |

**段 key 约定：**
- `opening` / `closing` — 单段
- `practice.case-01` / `practice.case-02` / … — per-case
- `transitions` — 过渡文件整体（rewrite 罕用，保留端点一致性）

### 7.1 SSE events（新增）

- `writer.section_started` `{section_key, agent, cli, model}`
- `writer.section_completed` `{section_key, agent, duration_ms, chars}`
- `writer.section_failed` `{section_key, agent, error}`
- `writer.rewrite_chunk` `{section_key, chunk}` —— 流式 rewrite 增量
- `writer.rewrite_completed` `{section_key, last_agent}`
- `writer.style_critic_applied` `{sections_changed: string[]}`
- `writer.final_rebuilt` `{at}` —— 任一段保存后 final.md 重生

加入 `useProjectStream` EVENT_TYPES 白名单。

## 8. 前端 UI

### 8.1 左栏 Accordion 第 6 个 Section

```
Article   [状态 badge]
```

Badge 规则（SectionStatusBadge 加 `writer.*` agent prefix）：
- evidence_ready：`待开始`
- writing_configuring：`进行中`（用户在配表单）
- writing_running：`N/M 完成 🟢`（已完成段/总段）
- writing_ready / writing_editing：`completed` 或 `编辑中 🔵`
- writing_failed：`失败 🔴`

展开后内容按状态：

**evidence_ready / writing_configuring**：一句话说明 + 提示"在右栏配置并开始"

**writing_running**：per-agent 实时进度卡片（复用 AgentTimeline 过滤 `writer.*` 前缀）

**writing_ready / writing_editing**：段落结构树

```
📝 开头                     writer.opening · 2 分钟前
📝 实测
  ├ case-01                 writer.practice · ✓
  ├ case-02                 ⚠ 正在 @agent 重写
  └ case-03                 human · 5 分钟前
📝 结尾                     writer.closing · 1 分钟前
─────
参考账号: 赛博禅心 / 数字生命卡兹克
[导出 final.md]
```

点段落 → 右栏编辑器自动滚动到对应 marker。

### 8.2 右栏（状态路由）

**evidence_ready / writing_configuring → `WriterConfigForm`：**

```
┌ writer.opening ────────────────────────────────┐
│ cli/model: [claude ▾] [opus ▾]  (default)      │
│ 参考账号:   [x] 赛博禅心  [ ] 数字生命卡兹克  … │
├ writer.practice ──────────────────────────────┤
│ cli/model: [claude ▾] [sonnet ▾]               │
│ 参考账号:   [ ] 赛博禅心  [x] 数字生命卡兹克  … │
├ writer.closing ────────────────────────────────┤
│ cli/model: [claude ▾] [opus ▾]                 │
│ 参考账号:   [x] 赛博禅心  …                    │
├ practice.stitcher ────────────────────────────┤
│ cli/model: [claude ▾] [haiku ▾]                │
├ style_critic ──────────────────────────────────┤
│ cli/model: [claude ▾] [opus ▾]                 │
│ 参考账号:   [x] 赛博禅心  [x] 数字生命卡兹克  │
└────────────────────────────────────────────────┘
[开始写作] （ActionButton）
```

- 默认值从 ConfigStore 拉
- 参考账号候选从 crossing-kb 列举（GET /api/kb/accounts 或同构接口）
- 提交写入 `project.writer_config` + 触发 start

**writing_running → `WriterProgressPanel`：**

per-agent 卡片：
```
✅ writer.opening          2.3s · claude/opus
🟢 writer.practice.case-01 运行中…
🟢 writer.practice.case-02 运行中…
⏸ practice.stitcher        等待 practice 完成
⏸ writer.closing           等待
⏸ style_critic             等待
```

某段失败：卡片变红，右侧出现「重跑这段」按钮（POST /retry-failed 带特定 section_key 参数；若后端仅支持全量 retry-failed，UI 照用）。

**writing_ready / writing_editing → `ArticleEditor`：**

- 整篇 markdown 编辑器（优先用现有依赖；无则 CodeMirror + 预览切换）
- 内部内容 = 各 section + marker 拼接
- 左上：`编辑 ↔ 预览` 切换
- 选中一段文字后浮动工具栏：`[🤖 @agent 重写]`
  - 检查选区完全落入一个 `<!-- section:X -->` 范围内；跨段则按钮 disabled + tooltip "只能选择单一段落"
  - 点击弹小窗输入 `user_hint`（可空） → POST /rewrite → SSE `writer.rewrite_chunk` 流式把该 section marker 内的内容逐步替换 → 完成回推 `rewrite_completed` 后端已写回文件
- 底部：
  - debounce 3s 自动保存（静默；失败 toast）
  - 显式 `[保存]` ActionButton
  - `[导出 final.md]` 下载按钮
- 手工编辑 & @agent 并发保护：某段 rewrite 运行期间该 section 变只读（overlay + spinner）

### 8.3 选区 → section key 算法

编辑器拿到当前 selection 的起止 offset，向上/向下扫最近的 `<!-- section:X -->` / `<!-- section:Y -->`：
- 起止之间不跨任何其他 marker → 返回 X
- 跨了 → 返回 null，工具栏禁用

## 9. 错误处理

- **orchestrator 任一段失败**：整体状态转 `writing_failed`，已完成段落保留，`project.writer_failed_sections: string[]` 记录
- **retry-failed**：只重跑 failed 集合；成功后转回 writing_running 或直接 writing_ready（看剩余段）
- **rewrite 失败**：SSE 推 `writer.rewrite_failed`，前端 toast + 该段恢复到流式开始前的内容；overlay 撤销
- **PUT section 400**：frontmatter 丢失 / section key 不匹配 → 前端红字 echo
- **marker 丢失**：前端解析 fallback 到 H1/H2 恢复，若失败弹 "边界丢失，请手动保存为整篇并重建结构"，后端保存为 `sections/_broken_backup_<ts>.md` 作为兜底，避免丢数据
- **参考账号不存在**：WriterConfigForm 提交时后端校验 crossing-kb 存在性；不存在返 400 列出缺失账号

## 10. 测试策略

约 40 个 tests。保持 SP-01~SP-04 的 247 全部不回归。

| 模块 | 类型 | 用例 |
|---|---|---|
| `writer-orchestrator.ts` | unit | C 级联正常流 / 某段失败 → writing_failed / retry-failed 只重跑失败段 / per-project override 优先 |
| 5 个 agent 类 | unit（mocked invokeAgent） | 参考账号 prompt 注入 / evidence screenshot 以 vision 附件传入 / per-case 粒度 |
| `article-store.ts` | unit | section CRUD / final.md 合并顺序正确 / marker 切分 / 丢 marker fallback 走 H1/H2 / 仍失败则备份 _broken |
| `POST /writer/start` | route | 200 转状态 / 400 前置状态错 / 400 reference_accounts 不存在 |
| `GET/PUT /writer/sections/:key` | route | round-trip / 未知 key 404 / PUT 更新 last_agent=human |
| `POST /writer/sections/:key/rewrite` | route | SSE 流式 chunk / 完成写回 / 跨 section key 400 / rewrite_failed 状态回滚 |
| `GET /writer/final` | route | 合并正确 / frontmatter 顶层带 accounts |
| `POST /writer/retry-failed` | route | 部分成功 / 全部成功转 ready |
| `WriterConfigForm` | component | 渲染 default / 提交带 override / 空参考账号也可提交 |
| `WriterProgressPanel` | component | per-agent 运行/完成/失败三态渲染 |
| `ArticleEditor` | component | marker 拼接 / 选区 → section 算法 / 跨段选中工具栏禁用 / 流式替换 / 自动保存 debounce |
| `useWriterSections` hook | component | SSE 推送 section_completed 局部刷新 |
| e2e（web-server） | route | evidence_ready → start → mock 五类 agent 全成功 → sections 可读 → PUT 改一段 → rewrite 一段 → final.md 正确 / 一段失败 → retry-failed → ready |

## 11. 估算

3 天 / 18-22 个 TDD task：

| 里程碑 | tasks | 内容 |
|---|---|---|
| M1 状态机 + ConfigStore 扩展 | 2 | 新增 writing_* 状态 + reference_accounts 字段 |
| M2 5 类 agent + prompts | 5 | 5 个 agent class + 5 个 prompt md |
| M3 orchestrator | 2 | pipeline + 失败分段重试 |
| M4 article-store | 2 | CRUD + final.md merge + marker 切分 + fallback |
| M5 后端路由 | 4 | start / sections / rewrite-stream / final + retry-failed |
| M6 前端 client + hooks | 2 | writer-client + useWriterSections |
| M7 前端组件 | 4 | ConfigForm / ProgressPanel / ArticleEditor / ArticleSection（左栏） |
| M8 集成 | 1 | ProjectWorkbench 接入 + SectionStatusBadge 扩展 |
| M9 e2e + smoke | 2 | integration test + 人工 MetaNovas 全流程 |

## 12. Future Work（明确本期不做）

| 编号 | 内容 | 触发条件 |
|---|---|---|
| 12.1 | 账号细致蒸馏 pipeline（SP-06）：从账号全量历史抽 style profile，Writer 读 profile 而非 RAG | SP-05 跑完发现 RAG 风格污染/不稳定 |
| 12.2 | 任意范围 rewrite（方案 B） | 用户体验 A 后反馈粒度不够 |
| 12.3 | 评论式 rewrite（方案 C） | 同上 + 协作需求 |
| 12.4 | 多版本历史 `sections/history/` | 用户出现"改错了想退回"需求 |
| 12.5 | 飞书 / 公众号直发（SP-07+） | SP-05 首稿质量稳定后 |
| 12.6 | 多人协作 / 评审权限 | 远期 SaaS 化 |
| 12.7 | style_critic 改为 C 选项（批注+一键应用） | 用户反馈自动重写"抹平特色" |

## 13. 交付物

1. 本 spec 提交 git
2. 实施计划 `docs/superpowers/plans/2026-04-14-sp05-writer.md`
3. 18-22 个 TDD task
4. 完成后人工 smoke：在 MetaNovas 项目从 evidence_ready 跑出 final.md，并做至少一次 @agent rewrite
5. 如 smoke 中发现 12.1 的必要性，排入 SP-06
