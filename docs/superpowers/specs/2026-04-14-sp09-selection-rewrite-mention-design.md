# SP-09 Selection Rewrite + @-Mention Design

**Status**: Approved (brainstorming 2026-04-14)
**Scope**: Replace SP-08 manual `[🔧 @skill]` flow with inline selection-based rewrite + `@` mention引用面板

## 1. 动机

SP-08 落地后用户反馈：手动 `🔧 @skill` 按钮 → 弹窗 → pin → 再整段重写，交互割裂且粒度粗。真实需求是「在段落里圈一段文字，describe 怎么改，顺便 `@` 引素材，**只改那一段**」。

SP-09 把这套流程统一到一个入口，删掉 `SkillForm` / `pendingPinsStore` / POST `/skill` / GET+DELETE `/pinned*` 路由，精简代码同时 UX 收敛。

**Writer agent 自主多轮 tool 调用链（runWriterWithTools + tools_used frontmatter）完整保留**。

## 2. 用户流程

1. 段落视图模式下，用户划选一段文本（浏览器原生 text selection）
2. 选区上方浮现 bubble `✍️ 重写选中`
3. 点 bubble → 段落卡片下方升起 inline composer
   - 顶部：选中文字预览（>60 字截断）
   - 中部：prompt textarea，placeholder `描述怎么改它，@ 引用素材...`
   - 底部：`Esc 取消` / `⌘↵ 提交`
4. textarea 里打 `@` → 浮出候选列表（≤12 条）
   - 条目：`[wiki] AI.Talk — 赵汗青创立的 AI 内容工作室...`  或  `[raw] 2024-08-28 · 花叔 · 全球Top100...`
   - 边打字实时过滤（防抖 120ms → `GET /suggest?q=`）
   - ↑↓ 导航，回车选中
5. 选中后 textarea 插入 pill token `[wiki:AI.Talk]`（可 backspace 删除）；composer 内存里绑定该条完整 excerpt
6. ⌘↵ 提交 → SSE 流式 rewrite → 后端精确替换选中段 → 写回 section → UI 更新

**关闭语义**：Esc 关闭 composer；点段落外区域**不**关闭（避免误关丢 prompt）

## 3. 架构

### 前端（3 新 + 2 改 + 1 删）
- 新 `SelectionBubble.tsx` —— 监听 `mouseup`，`window.getSelection()` 判定在本段内，选区上方绝对定位
- 新 `InlineComposer.tsx` —— textarea + mention 引擎（手写）+ pill + ⌘↵ 提交 + SSE 消费
- 新 `MentionDropdown.tsx` —— 候选列表 + 键盘导航
- 新 `useTextSelection.ts` —— selection 监听 hook，暴露 `{range, rect, text}`
- 改 `ArticleSection.tsx` —— 挂载 bubble / composer，删 `[🔧 @skill]` 按钮、`skillOpen` state、`<SkillForm/>`；`ReferencePanel` 去 pinned 分支
- 改 `writer-client.ts` —— 增 `suggestRefs` / `rewriteSelection`；删 `callSkill` / `getPinned` / `deletePin`

### 后端（2 新 + 1 改 + 1 删）
- 新 `GET /api/writer/suggest?q=&limit=` —— 并行 searchWiki + searchRaw，合并 ≤12 条
- 新 `POST /api/projects/:id/writer/sections/:key/rewrite-selection` —— SSE 流式重写
- 改 `writer.ts` —— 删 POST `/skill`、GET/DELETE `/pinned*`、`include_pinned_skills` 分支
- 删 `state/pending-pins.ts`

### 复用不动
- `@crossing/kb` skills（searchRaw/searchWiki/dispatchSkill）
- `runWriterWithTools` 多轮工具对话
- `frontmatter.tools_used` 写入链

## 4. API 契约

### GET `/api/writer/suggest?q=AI&limit=12`

**响应**
```json
{
  "items": [
    { "kind":"wiki", "id":"entities/AI.Talk.md", "title":"AI.Talk", "excerpt":"赵汗青创立的 AI 内容工作室..." },
    { "kind":"raw",  "id":"de59de0ce31e43511a47", "title":"全球Top100...", "account":"花叔", "published_at":"2024-08-28", "excerpt":"...<b>AI</b>..." }
  ]
}
```

**逻辑**
- `q.trim().length < 1` → `{items:[]}`
- 并行 `searchWiki(q, {limit:6})` + `searchRaw({query:q, limit:6})`
- 合并排序：wiki 类优先（知识 anchor 更稳），同类按原始排序
- 上限 `limit`（默认 12）

### POST `/api/projects/:id/writer/sections/:key/rewrite-selection` (SSE)

**请求**
```json
{
  "selected_text": "AI 内容工作室已经越来越多",
  "user_prompt": "用更有数据支撑的说法改写",
  "references": [
    { "kind":"wiki", "id":"entities/AI.Talk.md", "title":"AI.Talk", "excerpt":"..." },
    { "kind":"raw",  "id":"de59de0ce31e43511a47", "title":"..." }
  ]
}
```

**服务端顺序**
1. 读 section markdown body
2. 校验 `selected_text` 是 body 子串；0 匹配 → 400 `{error:"selected_text not found"}`；≥2 匹配取第一处并附 `match_index:0`
3. 按 `references` fetch 完整上下文（wiki: 读 vault 文件全文；raw: sqlite `body_plain`；失败→skip 记 warning）
4. 构造 user message：
   ```
   [段落完整上下文]
   <原段落 markdown>

   [需要改写的部分]
   <selected_text>

   [引用素材]
   ## [wiki] AI.Talk
   <full body>

   ## [raw] 全球Top100... (花叔 2024-08-28)
   <body_plain 截断 ~3k tokens>

   [改写要求]
   <user_prompt>

   仅输出改写后的新文本（纯文本，不要 markdown 围栏、不要重复原文、不要解释）
   ```
5. 跑 `runWriterWithTools`（agent 仍可再调 search_raw / search_wiki 补素材，走现有多轮 tool 路径）
6. 拿到 `content` → `newBody = body.replace(selected_text, content)`（只替换第一处）
7. `ArticleStore.writeSection` 写回；frontmatter 合并 `tools_used`（追加本次 ToolUsage）
8. SSE 事件序列：
   - `writer.started` `{sectionKey, mode:"rewrite-selection"}`
   - `writer.tool_called` / `writer.tool_returned` / `writer.tool_failed` / `writer.tool_round_completed`（若 agent 自主调了 tool）
   - `writer.selection_rewritten` `{sectionKey, selected_text, new_text, content_full}`（新事件）
   - `writer.completed` `{sectionKey}`

## 5. 数据/类型

### `SuggestItem`（新）
```ts
interface SuggestItem {
  kind: "wiki" | "raw";
  id: string;              // wiki: path; raw: article_id
  title: string;
  excerpt: string;         // <= 200 chars, 可含 <b> 高亮（raw）
  account?: string;        // raw only
  published_at?: string;   // raw only
}
```

### `MentionPill`（composer 内存）
```ts
interface MentionPill {
  kind: "wiki" | "raw";
  id: string;
  title: string;
  full_excerpt: string;    // 插入时抓一次，供 rewrite 提交用
}
```

### `WriterToolEvent` 追加分支
```ts
| { type: "selection_rewritten"; sectionKey: SectionKey; selected_text: string; new_text: string; ts: string }
```

## 6. 删除清单

**路由/state**
- `packages/web-server/src/routes/writer.ts` 删除以下：
  - POST `/api/projects/:id/writer/sections/:key/skill`
  - GET `/api/projects/:id/writer/sections/:key/pinned`
  - DELETE `/api/projects/:id/writer/sections/:key/pinned/:index`
  - rewrite 路由内 `include_pinned_skills` / `pinnedContext` 分支
- `packages/web-server/src/state/pending-pins.ts` 整个文件
- 相关测试（pinned store、rewrite-with-pins 断言）

**UI**
- `packages/web-ui/src/components/writer/SkillForm.tsx`
- `packages/web-ui/src/components/writer/__tests__/SkillForm.test.tsx`
- `packages/web-ui/src/components/writer/__tests__/ArticleSection-skill-button.test.tsx`
- `ArticleSection.tsx` 里 `[🔧 @skill]` 按钮 + `skillOpen` state + SkillForm 渲染 + `ReferencePanel` 内 pinned fetch 分支
- `writer-client.ts` 中 `callSkill` / `getPinned` / `deletePin` / `PinnedItem` / 本地 `SkillResult` type 引用

**保留**
- `@crossing/kb` 所有 skills
- `writer-tool-runner.ts` + 4 writer agents 的自主调用链
- `frontmatter.tools_used` + ReferencePanel 对它的渲染

## 7. 验收

- [ ] 用户能划选文本并弹出 bubble；点 bubble 升起 composer
- [ ] 打 `@AI` 候选列表浮出，≥1 条 wiki + ≥1 条 raw（若 ingest 过）
- [ ] 候选键盘导航 + 回车插入 pill
- [ ] ⌘↵ 提交 → SSE `writer.started` → `writer.selection_rewritten` → `writer.completed` 按序
- [ ] 段落只替换选中部分，其余文本不变
- [ ] `frontmatter.tools_used` 追加本次调用记录
- [ ] Esc 关闭 composer 不提交
- [ ] `selected_text` 在 body 不存在 → 400 错误，UI 提示
- [ ] 原 `[🔧 @skill]` / `/skill` / `/pinned*` 全部移除，相关测试移除
- [ ] 整段 rewrite（hover `✍️ 重写`）和 Writer agent 自主 tool use 仍正常

## 8. 不在本 spec 范围

- contentEditable 段落编辑（仅选择 → 浮 bubble → rewrite；不做 WYSIWYG）
- 多段跨选（选区横跨两个段落）
- 候选列表结果预取/缓存
- 引用内容的 token 预算智能裁剪（MVP 固定 3k/条截断）
