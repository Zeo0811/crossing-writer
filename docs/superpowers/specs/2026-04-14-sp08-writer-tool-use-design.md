# SP-08 Writer Tool-Use 设计稿

**日期：** 2026-04-14
**前置：** SP-05 Writer 已上线（4 段 writer agent + orchestrator）；SP-07 Wiki 已上线（`search_wiki` 已导出，refs.sqlite 有 FTS5 表 `ref_articles_fts`）
**目标：** 让 4 个 writer agent（opening / practice / closing / style_critic）在写作过程中**主动**调用 `search_wiki` / `search_raw` skill 检索资料；同时给用户提供"修订时手动 @-skill pin 资料强行注入下次 rewrite"的能力
**范围：** 多轮 tool dialog runner + 2 个 skill（wiki + raw）+ 4 agent 接入 + 后端 3 路由扩展 + 前端段落卡片「本段引用」+ SkillForm + AgentTimeline tool 事件
**非目标：** MCP / 原生 function calling 升级（沿用现有 ` ```tool ``` ` 文本块协议）；跨 section pin 共享；pin 持久化（in-memory，重启清空）；自动 references 段生成；search_raw 向量检索；工具并发（每 round 串行）

---

## 1. 背景

SP-05 Writer 把"段落级写作 + 段落级 @agent 重写"做完后，agent 输出质量瓶颈逐渐从"风格"转向"事实/案例的可参考性"——SP-07 已经把 Karpathy 式 wiki 编译完成，但 writer 用不上：

- 写开头需要"AI 漫剧的播放量数据" → wiki 里有 observation 页，writer 不知道
- 写实测段需要"别人测同类产品的 prompt 怎么写" → wiki cases 里有，writer 不知道
- 写结尾需要"行业判断的现有共识" → wiki concepts 里有，writer 不知道

SP-08 把两条线打通：

1. **初稿生成时自动检索**：4 个 writer agent 进入"多轮 tool dialog"，自主决定查什么、查几次、查完再写
2. **修订时人工 pin**：用户可以在某段卡片点 "🔧 @skill" 主动查一次，结果 pin 进 session，下次 `@agent 重写` 时该 pin 注入 system prompt 头部强制让 agent 看

skill 协议沿用 SP-03 case-expert 已经在跑的 ` ```tool ``` ` 文本块格式（无需 MCP 升级，无新 CLI 参数依赖）。

## 2. 架构

### 2.1 多轮 tool dialog（自主调用）

```
writer-tool-runner.runWithTools({
  agent, systemPrompt, initialUserMessage, maxRounds=5, dispatchTool, onEvent, pinnedContext?
})

  systemPrompt = base_writer_prompt + tool_protocol + (pinnedContext if any)
  messages = [system, user(initialUserMessage)]
  
  for round in 1..maxRounds:
    text = agent.invoke(messages)
    toolBlocks = parseToolCalls(text)
    if toolBlocks.empty:
      return { finalText: text, toolsUsed, rounds: round }
    
    onEvent(tool_round_started)
    for block in toolBlocks:
      onEvent(tool_called)
      result = await dispatchTool(block)
      toolsUsed.push({ block, result, pinned_by: "auto", round })
      onEvent(tool_returned)
    
    messages.push(assistant(text))
    messages.push(user(formatToolResults(round, results)))
  
  // hit maxRounds：用最后一次 text 作为 final
  return { finalText: messages.last_assistant, toolsUsed, rounds: maxRounds }
```

### 2.2 手动 pin 流程

```
1. 用户在段落卡片点 "🔧 @skill"
2. 弹 SkillForm 选 tool + args + 执行
3. POST /writer/sections/<key>/skill 同步执行 dispatchSkill
4. 服务端把结果存 in-memory pendingPins[projectId][sectionKey].push({...})
5. UI 在「本段引用」栏插入一条带 📌 user 标记
6. 用户后续触发 @agent 重写（POST /writer/sections/<key>/rewrite）
7. rewrite 端点取出 pendingPins → 转成 pinnedContext 字符串 → 传给 runWithTools
8. agent 看到 system prompt 顶部多一段 [User-pinned references]
9. rewrite 完成后 server 清空该 section 的 pendingPins，但 frontmatter.tools_used 永久记录
```

## 3. 两个 skill

### 3.1 search_wiki

已在 SP-07 实现并导出（`@crossing/kb` `searchWiki(input, ctx)`）。本期不改实现，只在 dispatcher 注册。

### 3.2 search_raw（新增）

在 `packages/kb/src/skills/search-raw.ts`：

```ts
export interface SearchRawInput {
  query: string;
  account?: string;
  limit?: number;        // default 5
}

export interface SearchRawHit {
  article_id: string;
  account: string;
  title: string;
  published_at: string;
  snippet: string;       // FTS5 highlighted, ~80 chars window
}

export function searchRaw(input: SearchRawInput, ctx: { sqlitePath: string }): SearchRawHit[];
```

实现：直接 SQL FTS5 查 `ref_articles_fts` 已有的虚拟表（`body_segmented` 字段已分词）：

```sql
SELECT
  ra.id, ra.account, ra.title, ra.published_at,
  snippet(ref_articles_fts, 2, '<b>', '</b>', '...', 32) AS snippet
FROM ref_articles_fts
JOIN ref_articles ra ON ra.rowid = ref_articles_fts.rowid
WHERE ref_articles_fts MATCH @q
  [AND ra.account = @account]
ORDER BY rank
LIMIT @limit
```

## 4. Tool 协议（文本块）

`packages/agents/src/prompts/_tool-protocol.md`（include 到 4 个 writer agent 的 system prompt 末尾）：

````markdown
## 工具调用协议

如果你需要查 wiki 或 raw 文章作参考，输出 ```tool 块（每行一条命令）：

```tool
search_wiki "<query>" [--kind=entity|concept|case|observation|person] [--limit=5]
search_raw "<query>" [--account=<account_name>] [--limit=3]
```

规则：
1. 一次 round 可以发多个命令（每行一条）
2. 你最多可以来 **5 round**；查完一直到不再发 tool 块就视为你写完了
3. 如果你不需要查任何东西，直接输出最终段落，不发 tool 块
4. 工具结果会作为 user message 追加给你；基于结果继续写或继续查
5. quoted 引用 wiki 内容时记得带 source（例如 "据 concepts/AI漫剧.md..."）
````

## 5. 4 个 agent 装 skill

| Agent | 装 | 不装 |
|---|---|---|
| `writer.opening` | ✅ |  |
| `writer.practice` | ✅ |  |
| `writer.closing` | ✅ |  |
| `style_critic` | ✅ |  |
| `practice.stitcher` |  | ❌（写 1-2 句过渡，无价值） |

每个 agent 实现层只改一件事：把内部直接 `invokeAgent(...)` 改成 `runWithTools({ agent, ..., dispatchTool, onEvent })`。`agent.invoke` 还是用底层 `invokeAgent`，但 runner 帮 agent 做多轮循环。

## 6. Tool dispatcher

`packages/kb/src/skills/dispatcher.ts`：

```ts
export interface SkillContext {
  vaultPath: string;
  sqlitePath: string;
}

export type ToolCall = { command: string; args: string[] };

export type SkillResult =
  | { ok: true; tool: string; hits: unknown[]; formatted: string }
  | { ok: false; tool: string; error: string };

export async function dispatchSkill(call: ToolCall, ctx: SkillContext): Promise<SkillResult>;
```

支持：
- `search_wiki` → 调 `searchWiki(input, { vaultPath })`，formatted 为 markdown 列表（path / title / kind / score / excerpt）
- `search_raw` → 调 `searchRaw(input, { sqlitePath })`，formatted 为 markdown 列表（article_id / account / title / snippet）

未知 command → `{ ok: false, error: "unknown tool: <name>" }`，runner 把 error 也作为结果回灌给 agent（让它知道工具不存在不要再发）。

参数解析（既支持 case-expert 现有的 `--key=value` 也支持 quoted 第一参数）：
- 第一个非 `--` token 作为 query
- 其余 `--key=value` 作为可选参数

## 7. writer-tool-runner

`packages/agents/src/writer-tool-runner.ts`：

```ts
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export interface AgentInvoker {
  invoke(messages: ChatMessage[], opts?: { images?: string[] }): Promise<{ text: string; meta: { cli: string; model?: string; durationMs: number } }>;
}

export interface ToolUsage {
  tool: string;
  args: Record<string, string>;
  query: string;
  pinned_by: "auto" | `manual:${string}`;
  round: number;
  hits_count: number;
  hits_summary: Array<{ path?: string; title?: string; score?: number; account?: string; article_id?: string }>;
}

export interface WriterToolEvent {
  type: "tool_called" | "tool_returned" | "tool_failed" | "tool_round_completed";
  section_key?: string;
  agent: string;
  tool?: string;
  args?: Record<string, string>;
  round: number;
  hits_count?: number;
  duration_ms?: number;
  error?: string;
  total_tools_in_round?: number;
}

export interface WriterRunOptions {
  agent: AgentInvoker;
  agentName: string;                    // for events
  sectionKey?: string;                  // for events
  systemPrompt: string;
  initialUserMessage: string;
  maxRounds?: number;                   // default 5
  pinnedContext?: string;               // 来自手动 @-skill
  dispatchTool: (call: ToolCall) => Promise<SkillResult>;
  onEvent?: (ev: WriterToolEvent) => void;
  images?: string[];                    // 透传给 agent.invoke
}

export interface WriterRunResult {
  finalText: string;
  toolsUsed: ToolUsage[];
  rounds: number;
  meta: { cli: string; model?: string; durationMs: number; total_duration_ms: number };
}

export async function runWriterWithTools(opts: WriterRunOptions): Promise<WriterRunResult>;
```

实现要点：
- pinnedContext 不为空 → 拼到 systemPrompt 末尾的 `## User-pinned references` 段
- 多轮循环最大 maxRounds=5，达上限强制取最后一次 text
- 每轮 tool 块**串行**执行（不并发，避免 token 爆炸 + 简化错误处理）
- 单个 tool 失败 → result 是 `{ok: false}`，formatted 写 `(失败: <error>)`，继续后续 tool；不中断 round
- 收集 toolsUsed 全程（含失败），后续 frontmatter 持久化
- onEvent 在每个关键点回调（不影响主流程）

## 8. 后端 API

### 8.1 改动

`POST /api/projects/:id/writer/sections/:key/rewrite` body 加可选字段：
```json
{
  "user_hint": "...",
  "selected_text": "...",
  "include_pinned_skills": true   // 默认 true；false 则忽略 pendingPins
}
```

服务端读取 `pendingPins[projectId][sectionKey]` → 拼成 pinnedContext → 传给 runWriterWithTools。完成后清空该 sectionKey 的 pin。

### 8.2 新增

| Method | Path | 语义 |
|---|---|---|
| POST | `/api/projects/:id/writer/sections/:key/skill` | body: `{ tool, args }`；同步执行 dispatchSkill；返回 `{ ok, hits, formatted }`；自动 push 到 pendingPins |
| GET | `/api/projects/:id/writer/sections/:key/pinned` | 返回 `{ pins: SkillResult[] }` 当前 pending pins |
| DELETE | `/api/projects/:id/writer/sections/:key/pinned/:index` | 移除某条 pin（用户改主意） |

### 8.3 新 SSE 事件

加入 `useProjectStream` EVENT_TYPES 白名单：

- `writer.tool_called` `{section_key, agent, tool, args, round}`
- `writer.tool_returned` `{section_key, agent, tool, hits_count, duration_ms, round}`
- `writer.tool_failed` `{section_key, agent, tool, error, round}`
- `writer.tool_round_completed` `{section_key, agent, round, total_tools_in_round}`

orchestrator + rewrite 都通过 `onEvent` 把上述事件推到 SSE 流。

## 9. Frontmatter 扩展

每段 `sections/<key>.md` frontmatter 加 `tools_used` 字段（`ArticleStore.writeSection` 透传）：

```yaml
section: opening
last_agent: writer.opening
last_updated_at: 2026-04-14T16:00:00Z
reference_accounts: [赛博禅心]
cli: claude
model: opus
tools_used:
  - tool: search_wiki
    query: "AI 漫剧"
    args: { kind: concept, limit: 5 }
    pinned_by: auto
    round: 1
    hits_count: 5
    hits_summary:
      - { path: "concepts/AI漫剧.md", title: "AI漫剧", score: 12.3 }
  - tool: search_raw
    query: "PixVerse 分镜"
    args: { account: 十字路口Crossing, limit: 2 }
    pinned_by: manual:user
    round: 0
    hits_count: 2
    hits_summary:
      - { article_id: "2026-04-08_AI-漫剧爆了", title: "AI漫剧爆了" }
```

每次 rewrite 完整覆盖该 section 的 `tools_used`（不累加历史；最近一次 rewrite 用了什么就是什么）。

## 10. 前端

### 10.1 ArticleSection 段落卡片增量

现有卡片 hover 出现 `[ 🤖 @agent 重写 ]`。SP-08 后变为：
```
[ 🤖 @agent 重写 ]  [ 🔧 @skill ]
```

新增「📚 本段引用」折叠栏（默认折叠，有数据时显示徽标 `📚 N`）：

```
📚 本段引用 4 处 ▸
  🤖 search_wiki "AI 漫剧" (concept) → 5 hits
       └ concepts/AI漫剧.md  [跳转]
  🤖 search_raw "PixVerse 分镜" (十字路口Crossing) → 2 hits
       └ 2026-04-08_AI-漫剧爆了
  📌 你 pin: search_wiki "镜山的写作风格" (person) → 1 hit
       └ persons/镜山.md
```

数据源：`section.frontmatter.tools_used` + `GET /pinned` 实时合并。

### 10.2 SkillForm 弹窗组件

`packages/web-ui/src/components/writer/SkillForm.tsx`：

```
┌ 调用 skill ───────────────────────────────┐
│ skill: ( • search_wiki ) ( ○ search_raw ) │
│                                            │
│ query: [_______________________________ ]   │
│                                            │
│ kind:    [ 任意 ▾ ]   account: [ 任意 ▾ ]   │
│ limit:   [ 5 ]                              │
│                                            │
│ [执行] [取消]                              │
└────────────────────────────────────────────┘
```

提交 → POST `/sections/:key/skill` → 成功后关闭，结果在「本段引用」栏显示带 📌。

### 10.3 AgentTimeline 渲染 tool 事件

`packages/web-ui/src/components/status/AgentTimeline.tsx` 加 4 种事件类型支持，用小图标渲染：
```
🟢 writer.opening · claude/opus
   🔧 round 1: search_wiki("AI 漫剧") → 5 hits (1.2s)
   🔧 round 1: search_raw("PixVerse 分镜") → 2 hits (0.8s)
   🔁 round 1 完成 (2 tools)
   🔧 round 2: search_wiki("镜山") → 1 hit (1.0s)
   🔁 round 2 完成 (1 tool)
   ✅ writer.opening 完成 (3 rounds, 3 tools)
```

## 11. 错误处理

| 场景 | 行为 |
|---|---|
| Tool 命令未知 | dispatcher 返 `{ok:false}`，runner 把 error 作为 user message 回灌；agent 看到后通常不会再重发 |
| Tool 执行抛错 | 同上，error 写进 formatted；不中断 round |
| 达 maxRounds | 把最后一次 agent text 作为 finalText（即使含 tool 块）；emit `tool_round_completed` 加 `reason: "max_rounds"` |
| pendingPins 在 server 重启后丢失 | 符合"一次性 pin"语义；UI 刷新会发现 `pinned: []`，提示用户重新 pin |
| Tool 返回结果太大（>20KB） | dispatcher 自动截断 + 加 `(truncated, N more hits)` 末尾 |

## 12. 测试

约 25-30 tests，保持前序 SP 不回归。

| 模块 | 用例 |
|---|---|
| `search-raw.ts` | FTS 命中 / account filter / 空结果 / sqlite 缺失返 `[]` / snippet 含 `<b>` 标记 |
| `dispatcher.ts` | search_wiki 路由 / search_raw 路由 / 未知 tool 返 ok=false / args 解析（quoted 第一参数 + --key=value） |
| `writer-tool-runner.ts` | 0 round 立即返回 / 多轮 1-3 round 终止 / 达 maxRounds=5 强停 / 单 tool 失败不中断 round / pinnedContext 注入 system prompt |
| `_tool-protocol.md` | 4 agent system prompt 都包含此段 |
| 4 agent | 装好 runner（mock invokeAgent 检查 invoke chain） |
| `routes/writer.ts` | POST /skill 同步执行 + push pin / GET /pinned 返当前 pins / DELETE /pinned/:i 删除 / rewrite 含 pinned_skills 时 system prompt 加段 / rewrite 后 pin 清空 |
| SSE | 4 个新事件白名单 / 流式格式 |
| 前端 | ArticleSection 渲染「本段引用」/ SkillForm 提交 / AgentTimeline 渲染 4 个事件 |
| e2e | mock 1 wiki + 1 raw → run writer.opening with tools → 验证多轮 + tools_used 落 frontmatter + SSE 4 个事件全发出 |

## 13. 估算

3 天 / 18-22 个 TDD task：

| M | tasks | 内容 |
|---|---|---|
| M1 skill 基础 | 3 | search-raw / dispatcher / _tool-protocol.md prompt include |
| M2 writer-tool-runner | 2 | runner 主流程 + maxRounds + pinnedContext + tools_used 收集 |
| M3 4 agent 接入 | 2 | 4 个 writer agent 改用 runner（合并为 2 task：opening+practice / closing+critic） |
| M4 后端 | 3 | rewrite body 扩展 + pendingPins / 新 skill 端点 / 新 pinned 端点（GET+DELETE） |
| M5 前端 | 4 | ArticleSection 「本段引用」/ SkillForm / hover skill 按钮 / AgentTimeline tool 事件 |
| M6 SSE 集成 | 1 | useProjectStream EVENT_TYPES 加 4 类型 |
| M7 e2e + smoke | 1 | mock e2e 多轮 dialog + tools_used 落盘 |

## 14. Future Work（明确不做）

- **MCP / 原生 function calling 升级**——claude/codex CLI 将来支持 native tool-use 后再迁，本期沿用 ` ```tool ``` ` 文本块（已在 SP-03 case-expert 跑过）
- **跨 section pin 共享**——pin 当前只 scope 到某 section 的下次 rewrite；写整篇 final 时不要"全篇 pin"
- **pin 持久化**——pendingPins server in-memory，重启清空，符合"一次性"语义
- **自动 references 段生成**——final.md 末尾自动追加"本文参考"列表来自 `tools_used` 聚合；本期 frontmatter 持久化即可，后续如有发布需求再加
- **search_raw 向量检索**——FTS5 keyword 够 MVP；语义检索等 SP-XX 加 embedding pipeline
- **工具调用并发**——每 round 串行执行；并发可能让 token 爆炸 + 错误处理复杂
- **search_kb_account / search_style_panel 等专项 skill**——本期 wiki + raw 已覆盖 90% 场景
- **自定义 skill 注册**——dispatcher 当前硬编码 2 个；用户加新 skill 走 SP-XX
- **tool 调用预算**——按 token / 时间限流；本期 maxRounds=5 是软上限，足够
- **历史 rewrite 的 tools_used 累积**——本期每次 rewrite 覆盖；不做时间线版本

## 15. 交付物

1. 本 spec 提交 git
2. 实施计划 `docs/superpowers/plans/2026-04-14-sp08-writer-tool-use.md`
3. 18-22 个 TDD task
4. 完成后人工 smoke：用 SP-07 已 ingest 的 wiki（数字生命卡兹克 / 卡尔的AI沃茨 等账号产生的 entities/concepts/cases/observations/persons）跑一次 SP-05 writer 全流程，验证：
   - AgentTimeline 出现 `🔧 search_wiki / search_raw` 事件
   - 段落卡片「📚 本段引用」栏列出 wiki 引用
   - 段落 `tools_used` frontmatter 字段被写入
   - 手动 @-skill pin 一条 → @agent 重写 → agent 输出明显反映了 pinned 内容
   - 跑完 pin 自动清空（GET /pinned 返 `{pins: []}`）
