# SP-D · 最后一步编辑器重做（Section-card 布局 + Tool use 可视化 + Diff/Undo）

## 背景

`ArticleEditor`（234 行）当前状态：

- 整篇文章塞进一个 `<textarea>`，以 `<!-- section:xxx -->` markers 分段
- 选中文字 → 飘在右上的弹出 bubble → 一行小 input 写 hint → 触发 `/rewrite` SSE
- SSE 事件只监听 `writer.rewrite_chunk`；其他事件（tool_called / validation_passed / validation_retry / ...）全部被丢弃 —— 用户不知道 agent 在干啥
- 改写期间 `readOnly={!!busySection}` 整个 textarea 锁死，不能滚、不能看别的段
- 改完没 diff，没 undo
- 裸 markdown，没 preview

用户反馈「编辑、tool use 都没法用，交互太差」—— 全面重做。

## 目标

把「最后一步」从一个 234 行的 textarea 升级成结构化的 section-card 编辑器，解决 6 大痛点：

1. 裸 markdown → 每张 card 默认渲染 markdown；Edit 模式切 textarea
2. Tool use 黑箱 → 改写时 timeline 实时流事件
3. Hint 局促 → 多行 textarea
4. 弹出框飘逸 → 改成 card 内嵌的 Rewrite tab
5. 无 diff / 无 undo → 改写完 inline diff + accept/reject + 撤回上一版
6. 全锁死 → 只锁当前 rewrite 的 card

## 范围

**在：**

- 拆 `ArticleEditor` 为 section-card 布局：`ArticleFlow` 顶层 + `SectionCard` x N
- `SectionCard` 组件：三态切换（View / Edit / Rewrite），内嵌 hint + tool timeline + diff
- `rewriteSectionStream` client 透传全部 SSE 事件（不只是 `rewrite_chunk`）
- 新增 `useSectionRewriteState` hook：管理单个 section 的 rewrite stream、diff、undo
- 全局 concurrent lock：`useRewriteMutex` context，保证同时最多 1 个 section 在改
- 新增 `SectionDiff` 组件：inline diff（`diff-match-patch` 库）
- 左侧 sidebar 保留，补上每段的字数 + 状态（edit pending / rewriting / clean）
- 测试：SectionCard / useSectionRewriteState / rewrite flow 集成

**不在：**

- 后端 `/rewrite` 端点或 SSE 事件 schema 改动（B.2/B.3 已经加了全部 validation 事件）
- 多步 undo history / 跨 session 持久化（只内存最近一次）
- 所见即所得（WYSIWYG）编辑 —— Edit 模式仍是 textarea，不变
- Comment threads / 协作
- 新的 export 格式
- 自动触发 style critic（仍人工点）
- Sidebar 以外的宏观导航（tab、搜索等）

## 决策

### 为什么 section-card 而不是继续 textarea + 加面板

用户明确选 A（全面重做）。继续 textarea 的路子（方向 B）留下两个根本痛点无法解决：
1. Markdown 裸编辑 —— 没法加 preview（整个 textarea 只有一种模式）
2. 弹出 bubble 位置 —— 在一个滚动 textarea 里永远飘得怪

Section-card 把每段独立成可编辑单元，天然解决；每段可以各自 View/Edit/Rewrite 模式切换。

- **Why**：文章结构是天然分段的（opening / practice.case-N / closing），UI 对齐这个结构更直观。
- **How to apply**：每张 card 一个 section_key，独立状态机。

### 为什么 inline diff 不 side-by-side

单张 card 在 flow 里宽度有限（主区 ~800px）。Side-by-side 两列各 ~380px 刚好读。但改写往往涉及多段落重写，side-by-side 视觉噪声大。Inline diff（添加绿底、删除红底删除线）更紧凑，阅读路径单向。

- **Why**：主区宽度不足以舒服做两列；inline diff 在 GitHub PR 这类场景早验证过可用。
- **How to apply**：`diff-match-patch` 按词级 diff，渲染时插 `<ins>` / `<del>`。

### 为什么 undo 只保留最近一次

用户这一步是人工 QA 阶段，改写频率低（一段 ≤5 次）。多步 history 意味着数据结构 + UI 都复杂化。最近一次「接受改写」前的内容就是撤回锚点，已覆盖 80% 场景。

- **Why**：YAGNI。多步 undo 是未来可以加的事，当前的痛点是「改完没 diff 没撤回」—— 最小可撤一步已解决。
- **How to apply**：每张 card 保留 `lastAcceptedBody: string | null`。

### 为什么 concurrent 限 1 个 rewrite

LLM 调用按个计费，且每次 bookend rewrite 跑 B.3 validation + 可能 retry 一次，重的。并发 2 个 rewrite 的场景几乎不存在 —— 用户是串行读文章+改。

- **Why**：防 token 爆炸 + UI 简单。
- **How to apply**：Context 级 mutex，活跃 rewrite 的 card 记录 section_key；其他 card 的「改写」按钮 disabled。

### 为什么不动后端

B.3 已经把 `writer.validation_passed` / `_retry` / `_failed` 加到 `/rewrite` SSE 事件流。B.2 的 tool event bridge 早已接好 `writer.tool_called` / `_returned` / `_round_completed`。前端全部丢了而已。这次只要透传。

- **Why**：后端已对齐，前端单侧改动即可。
- **How to apply**：`rewriteSectionStream` 的 callback 不再过滤 event type，全传给 UI。

## 架构

### 组件树

```
ArticleEditor (projectId)
  └── ArticleFlow
        ├── Sidebar
        │   ├── SectionList (points to each card)
        │   └── Actions (复制全文 / 导出)
        └── SectionCard x N
              ├── CardHeader (name, char count, status, tab switch)
              ├── ViewMode     | markdown render + 选中工具栏
              ├── EditMode     | textarea + auto-save
              └── RewriteMode
                    ├── HintArea (多行 textarea + 可选的 selected excerpt)
                    ├── ActionBar (改写 / 取消)
                    ├── ToolTimeline (stream of events)
                    ├── SectionDiff (inline diff after完成)
                    └── AcceptRejectBar (接受 / 驳回 / 再改一次)
```

### 状态机

单张 card 的 `mode` 状态：

```
  view ←→ edit
   ↓      ↓
   rewrite_idle
        ↓ 用户点「改写」
   rewrite_streaming
        ↓ 完成
   rewrite_done
        ├─ 接受 → view (with lastAcceptedBody 更新)
        ├─ 驳回 → view (原样)
        └─ 再改 → rewrite_streaming
```

Global：`useRewriteMutex` context 保证任一时刻 `rewrite_streaming` 状态只在一张 card 上。

### 数据流

```
触发改写
  ↓
card.mode = rewrite_streaming
mutex.acquire(sectionKey)
  ↓
rewriteSectionStream(projectId, key, { hint, selected_text })
  ├─ event: writer.tool_called → timeline.push({icon:🔧, tool, args})
  ├─ event: writer.tool_returned → timeline.push({icon:✓, hits})
  ├─ event: writer.validation_passed → timeline.push({icon:✓, chars})
  ├─ event: writer.validation_retry → timeline.push({icon:⚠, violations})
  ├─ event: writer.validation_failed → timeline.push({icon:✗, violations})
  ├─ event: writer.rewrite_chunk → newBody = chunk
  └─ event: writer.rewrite_completed → finalize
  ↓
card.mode = rewrite_done
computeDiff(oldBody, newBody)
  ↓
[user clicks accept]
putSection(projectId, key, newBody)
lastAcceptedBody = oldBody
card.mode = view
mutex.release()
```

## 组件细节

### `ArticleFlow` 顶层

Props: `projectId`

职责：
- 加载 `final.md`，解析 section markers → `SectionSpec[]`
- 把每个 section 的原始 body 传给 `SectionCard`
- 持有 `rewriteMutex` context

不写 state 本身（交给各 SectionCard）。

### `SectionCard`

Props: `projectId`, `sectionKey`, `initialBody`, `label`

内部 state:
- `mode: 'view' | 'edit' | 'rewrite_idle' | 'rewrite_streaming' | 'rewrite_done'`
- `body: string`（当前正文）
- `draftBody: string | null`（rewrite_streaming 累积 chunks）
- `lastAcceptedBody: string | null`（撤回锚点）
- `timeline: TimelineEvent[]`（tool events 累积）
- `hint: string`
- `selectedText: string | null`

事件 handler:
- `onEnterEdit()` → `mode = 'edit'`
- `onBodyChange(next)` → `body = next`; schedule save
- `onEnterRewrite(selected?)` → `mode = 'rewrite_idle'`; `selectedText = selected`
- `onTriggerRewrite()` → mutex.acquire → `mode = 'rewrite_streaming'` → stream
- `onAccept()` → putSection + `lastAcceptedBody = pre-rewrite body`; `mode = 'view'`
- `onReject()` → drop draft; `mode = 'view'`
- `onUndo()` → `body = lastAcceptedBody`; `lastAcceptedBody = null`

### `SectionDiff`

Props: `oldText`, `newText`

用 `diff-match-patch`（或 `diff` npm 包，评估时看 dep 大小）做词级 diff。

渲染：
- 未变 → 普通
- 新增 → `<ins class="bg-[var(--accent-fill)]">...</ins>`
- 删除 → `<del class="bg-[var(--red-fill)] line-through">...</del>`

### `ToolTimeline`

Props: `events: TimelineEvent[]`

TimelineEvent union:
```ts
type TimelineEvent =
  | { kind: 'tool_called'; tool: string; args: Record<string, unknown>; ts: number }
  | { kind: 'tool_returned'; tool: string; hits_count: number; duration_ms: number; ts: number }
  | { kind: 'tool_round_completed'; round: number; total_tools: number; ts: number }
  | { kind: 'validation_passed'; attempt: number; chars: number; ts: number }
  | { kind: 'validation_retry'; violations: Violation[]; ts: number }
  | { kind: 'validation_failed'; violations: Violation[]; ts: number }
  | { kind: 'rewrite_completed'; ts: number };
```

渲染成垂直 list（每行 24px 高），每个 event 一个 icon + 简短描述 + 时间。

### `useSectionRewriteState` hook

封装 SectionCard 的 rewrite 相关逻辑（mutex、stream、timeline、diff 计算）。独立 hook 方便测试。

### `useRewriteMutex` context

```ts
interface RewriteMutex {
  activeKey: string | null;
  acquire(key: string): boolean;  // returns false if someone else active
  release(key: string): void;
}
```

## 数据流（UI ↔ API）

**client 改动集中在 `packages/web-ui/src/api/writer-client.ts`**：

`rewriteSectionStream` 当前签名：
```ts
(projectId, key, hint?, onChunk: (event: {type, data}) => void) => Promise<void>
```

其中 `onChunk` 只处理 `writer.rewrite_chunk`。改成：

```ts
(
  projectId: string,
  key: string,
  opts: { hint?: string; selected_text?: string },
  onEvent: (event: RewriteStreamEvent) => void,
) => Promise<void>

type RewriteStreamEvent =
  | { type: 'writer.tool_called'; data: {...} }
  | { type: 'writer.tool_returned'; data: {...} }
  | { type: 'writer.tool_round_completed'; data: {...} }
  | { type: 'writer.validation_passed'; data: {...} }
  | { type: 'writer.validation_retry'; data: {...} }
  | { type: 'writer.validation_failed'; data: {...} }
  | { type: 'writer.rewrite_chunk'; data: { chunk: string } }
  | { type: 'writer.rewrite_completed'; data: {...} }
  | { type: 'writer.rewrite_failed'; data: { error: string } };
```

已经在调用 `rewriteSectionStream` 的地方（只有老 `ArticleEditor`）会被替换，所以 breaking change 可接受。

## 错误处理

- Rewrite 期间断网 / SSE 中断 → 触发 `rewrite_failed` 事件 → card 显示错误 + 回到 `rewrite_idle`，mutex 释放
- 接受后 `putSection` 失败 → toast 报错 + 保留 `rewrite_done` 状态让用户再试
- Diff 计算报错（超大输入）→ 退化为全量 replace display（"无 diff，只显示新版"），不阻塞接受流程
- 多段落粘贴到 card 里导致 edit 超长 → 不特殊处理（textarea 本来就撑得住）

## 测试

### 单元 / 组件

- `SectionDiff.test.tsx`：
  - 完全相同文本 → 无高亮
  - 纯新增 → 全绿
  - 纯删除 → 全红删除线
  - 混合 → 正确高亮
- `ToolTimeline.test.tsx`：各种 event kind 渲染正确
- `useSectionRewriteState.test.ts`：mock `rewriteSectionStream` 事件序列 → 验证 timeline 累积 / diff 生成 / accept 调用 putSection / reject 丢弃
- `useRewriteMutex.test.ts`：acquire 后再 acquire 返 false；release 后再 acquire 成功

### 集成

- `ArticleFlow.test.tsx`：
  - 初始渲染所有 section card（opening + practice.* + closing）
  - 切换 mode（view→edit→rewrite_idle→streaming→done→view）不报错
  - 触发 A 改写，同时在 B edit → B 编辑仍生效
  - A 改写中点 B 的改写按钮 → disabled + 提示
- mock SSE 回放一个完整事件流 → 验证最终 diff + putSection 调用

### E2E（trae project，手动）

- 跑一次 opening rewrite，hint = "更口语一点"
- 观察 timeline 实时流
- 验证 diff 正确（原文和新版不同的字有高亮）
- 点「接受」→ 刷新页面 → 新版本持久化
- 点「撤回」→ 回到原版

## 风险

| 风险 | 缓解 |
|---|---|
| Markdown 渲染慢（react-markdown） | Section-level memoize；body 通常 ≤ 500 字，单 card 渲染 < 10ms |
| diff-match-patch 打包大小 | 先估：~50KB min+gzip。可接受。若顾虑改用 `diff` npm 包（~15KB） |
| Tool timeline 变得很长 | scroll container + 折叠历史（默认展开最新 10 条，旧的折叠） |
| 改写期间用户切到别的 tab 返回 → state 丢 | `useSectionRewriteState` 持有 stream handle，切 tab 不影响（React state 保留） |
| selected_text 改写时 section_key 解析错 | 已有 `sectionKeyForSelection` 逻辑，沿用；选中跨段仍报错提示 |
| SSE 连接中断（代理断流） | 现有 fetch streaming 已有；加 try/catch + emit `rewrite_failed` |

## 非目标 / 未来

- 多步 undo history
- WYSIWYG markdown 编辑
- 跨 section 拖拽重排
- Comment threads / 标注
- Rewrite 模板库（"更口语" / "加数据" 快捷按钮）
- Rewrite 历史持久化到 vault
- AI 自动触发 style critic

## 验收标准

### 代码验收

- 全部 vitest 测试通过（新测试 + 原有不回归）
- Typecheck 清（除 3 个 pre-existing 错）
- `pnpm --filter @crossing/web-ui build` 成功
- Grep `readOnly={!!busySection}` 零命中（老机制删干净）

### 实测验收（trae project）

- 进 `writing_ready` 状态的 trae 项目
- 渲染出 section cards（opening / case-01/02/03/04 / closing），顺序正确
- 每张 card 默认 View 模式，markdown 正确渲染
- 切 Edit → 编辑 → 3s 后自动保存；重载页面仍在
- 点 opening 的「改写整段」→ hint 输入「更口语」→ 改写：
  - Timeline 实时出现 `tool_called` / `tool_returned` / `validation_passed`
  - 改写完成显示 inline diff
  - 接受 → putSection；撤回按钮出现
- 改写期间切 closing card 的 Edit → 照常能打字
- 改写期间点 closing 的改写按钮 → disabled + "正在改写 opening，稍候" 提示
- 点撤回 → opening 回到改写前

---

## Validation log

*待实施后追加*
