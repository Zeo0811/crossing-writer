# SP-19 ContextBundle 设计

> 状态：Draft
> 日期：2026-04-19
> 关联：SP-05 Writer / SP-09 Selection Rewrite / SP-10 Config Workbench / SP-12 Topic Expert

## 1. 动机

今天每个 agent 路由（writer-orchestrator / rewrite-selection / topic-expert-consult）各自组装上下文：brief 摘要、style panel、article body、tools_used、project override。逻辑分散在三处，重复且容易漂移：

- 同一项目的 brief 在不同 agent 看到的截断长度不一致
- style binding 解析（SP-10）在 rewrite 路径有，但 topic-expert 路径漏掉
- tools_used 历史在 selection rewrite 走完整 list，在 orchestrator 走 last-N，无统一约定

用户最初提出"想要 session"的诉求，本质是**希望 agent 之间对项目状态有一致理解**，而不是真正的 stateful claude 会话 ID。SP-19 因此**不做 session**，改做**显式统一 context snapshot**：每次调用 agent 前由 `ContextBundleService` 现场组装一份 `ContextBundle`，注入到 system prompt。

## 2. 核心概念 ContextBundle

```ts
interface ContextBundle {
  projectId: string;
  builtAt: string; // ISO
  brief: {
    summary: string;          // brief.raw_text 裁剪 ~800 chars
    productContext?: string;  // product-overview agent 产出
    topic?: string;           // selected topic decision
  };
  agents: Record<AgentKey, EffectiveAgentConfig>; // merged global+override
  styles: {
    opening?: { account: string; role: string; version: string; bodyExcerpt: string };
    practice?: { account: string; role: string; version: string; bodyExcerpt: string };
    closing?: { account: string; role: string; version: string; bodyExcerpt: string };
  };
  article: {
    opening: { markdown: string; manually_edited: boolean; tools_used: ToolUseRef[] };
    practiceCases: Array<{ id: string; markdown: string; tools_used: ToolUseRef[] }>;
    closing: { markdown: string; manually_edited: boolean; tools_used: ToolUseRef[] };
  };
  recentEdits: Array<{ section: string; at: string; kind: 'manual' | 'agent' }>; // last 10
  recentToolUses: Array<{ section: string; tool: string; ts: string; ok: boolean }>; // last 20
}
```

不变量：
- `builtAt` 是组装时刻，非 mutation 时刻（bundle 是投影，不是事件）
- `agents` 已经过 SP-10 override 合并，agent 路径可直接 `bundle.agents['writer-orchestrator']`
- `styles.*.bodyExcerpt` 由 styleBindingResolver 解析后裁剪 ~600 chars

## 3. 架构

`ContextBundleService` 位于 `packages/web-server/src/services/context-bundle-service.ts`，依赖：

- `ProjectStore` —— project meta + brief
- `ArticleStore` —— opening / practiceCases / closing markdown 与 tools_used
- `StylePanelStore` —— 当前绑定的 account/role/version
- `AgentConfigStore` —— 全局 agent 配置
- `ProjectOverrideStore` —— 项目级 override
- SP-10 `styleBindingResolver` —— style body 取回与版本解析

两种访问模式：

- `build(projectId): Promise<ContextBundle>` —— 全量重新读取所有源
- `buildLite(projectId, pick: Array<keyof ContextBundle>): Promise<Partial<ContextBundle>>` —— 仅读取请求字段，用于轻量调用（如 UI chip 只需要 builtAt + 估算 size）

无缓存层：每次调用都重新读盘。理由：本地 JSON I/O 相对 LLM 调用成本可忽略，避免缓存失效复杂度。

## 4. 集成到 agent 路径

三个入口统一替换为：

```ts
const bundle = await contextBundleService.build(projectId);
const systemPrompt = renderSystemPrompt({ ...existing, contextBlock: renderBundle(bundle) });
```

- **writer-orchestrator**（整段 rewrite）：`renderBundle` 输出 `[Project Context]` block，包含 brief.summary / styles / 当前 section markdown / recentEdits
- **rewrite-selection**：同一 bundle，`renderBundle` 额外强调 selection 所在 section 的 tools_used
- **topic-expert-consult**：`renderBundle` 优先 brief.productContext + brief.topic，省略 article body

旧的 ad-hoc 组装函数（`assembleWriterContext`、`buildSelectionContext`、`composeExpertPrompt` 中的 context 段）全部删除，仅保留 prompt 模板渲染。

## 5. Token budget

- Hard cap **6000 tokens**，估算 `text.length / 4`
- 超限按以下顺序裁剪，直到落入预算：
  1. `recentToolUses` 截断到 last 5
  2. `recentEdits` 截断到 last 3
  3. `brief.productContext` 截断到 400 chars
  4. `brief.summary` 截断到 400 chars
  5. `styles.*.bodyExcerpt` 截断到 200 chars
- 裁剪后在 bundle 中标记 `_truncated: true` 字段供 UI 提示

## 6. API

- `GET /api/projects/:id/context` —— 返回完整 bundle（含 `_truncated` 与 token 估算）
- 仅供 UI debug 与 e2e 验证，不参与 agent 路径（agent 走服务直调而非 HTTP 自调）
- **无 PUT** —— bundle 是派生投影，源数据通过既有 store API 修改

## 7. UI

`ProjectWorkbench.tsx` 右下角 floating chip：

- 文案：`Context 📦 ~3.2k tok`
- hover tooltip：显示 `builtAt` 与各分段 token 占比
- 点击弹出 modal，pretty-print JSON bundle，便于 debug
- 不提供编辑入口（投影只读）
- chip 数据源：`buildLite(projectId, ['builtAt'])` + token 估算端点 `GET /api/projects/:id/context?summary=1`

## 8. 验收

- [ ] `ContextBundleService.build()` 单测覆盖：brief 裁剪、agents override 合并、styles 解析、recentEdits/recentToolUses 排序
- [ ] writer-orchestrator / rewrite-selection / topic-expert-consult 三入口均通过 ContextBundleService 注入 context，旧 ad-hoc 组装函数已删除
- [ ] Token budget 生效：构造超 6000 token 的项目，bundle 自动裁剪并标记 `_truncated`
- [ ] `GET /api/projects/:id/context` 返回正确结构，包含 `_truncated` 字段
- [ ] ProjectWorkbench 右下角 chip 显示 token 估算与 builtAt
- [ ] 点击 chip 弹出 modal，展示 pretty-print JSON
- [ ] e2e：在三个入口分别触发 agent，断言三次调用收到的 context block 完全相同
- [ ] 性能：`build()` 在典型项目（10 practice cases）下 < 50ms

## 9. 不在本 spec 范围

- 真正的 session（claude conv id、stateful server memory）
- 跨项目 context 共享与全局工作区上下文
- ContextBundle 持久化为文件（每次按需现场组装，无快照存档）
- Bundle diff / 版本回放
- Agent 主动请求扩展字段（agent 总是被动接受全量 bundle）
