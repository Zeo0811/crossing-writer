# SP-03.5 UX 打磨 设计稿

**日期：** 2026-04-13
**前置：** SP-03 完成（30/31，Task 30 烟测部分完成，发现多处 UX 痛点）
**目标：** 补齐导致烟测卡顿的 3 类 UX 缺陷（按钮无反馈、agent 状态看不见、模型只能改 JSON），为后续 SP-04 铺路
**范围：** 纯前端 + 一条 config API，不动 agent/orchestrator 逻辑
**非目标：** 任何 markdown 渲染美化（延后到最终 UI 轮次统一做）

---

## 1. 背景与动机

SP-03 烟测（MetaNovas）中用户反复被以下 3 类问题打断：

1. **按钮点击无反馈** — 点"生成产品概览"、"批准"、"开跑 Case 规划"等按钮后没有 loading 指示，也没有成功/失败提示，只能靠 status 轮询+刷新页面判断是否进展。
2. **Agent 工作状态不透明** — 时间线之前一度不显示（聚合 bug），且 section 头只有 `[active]` / `[completed]` 这种粗粒度 state，看不出"当前这个 section 里的 agent 是运行/等待/失败"。SSE 连接断了也无感知。
3. **模型/CLI 切换需要改 JSON + 重启** — codex 配额耗尽时临时切 claude 必须手改 `config.json` + touch `server.ts` 触发 tsx reload；整个烟测被这个反复打断至少 4 次。

## 2. 解决方案概览

三组独立改动，各自闭合：

| 组 | 前端产物 | 后端产物 |
|---|---|---|
| B. 按钮反馈 | ActionButton, ToastProvider, Toast | 无 |
| C. Agent 状态 | SseHealthDot, SectionStatusBadge；useProjectStream 增强 | 无 |
| D. 模型切换 | SettingsDrawer | ConfigStore, GET/PATCH /api/config/agents；路由改读 configStore |

## 3. 架构

**纯前端 + 一条 config API + 内存热加载。** 不引入新的 UI 库（保持 Tailwind + 原生 fetch + React Context），不动任何 agent/orchestrator 实现。

### 3.1 新增文件

```
packages/web-ui/src/
├── components/
│   ├── ui/
│   │   ├── ActionButton.tsx
│   │   ├── Toast.tsx
│   │   └── ToastProvider.tsx
│   ├── status/
│   │   ├── SseHealthDot.tsx
│   │   └── SectionStatusBadge.tsx
│   └── settings/
│       └── SettingsDrawer.tsx

packages/web-server/src/
├── services/
│   └── config-store.ts
└── routes/
    └── config.ts
```

### 3.2 改动已有文件

- `packages/web-ui/src/hooks/useProjectStream.ts` — 暴露 `connectionState` 和 `lastEventTs`
- `packages/web-ui/src/pages/ProjectWorkbench.tsx` — 挂 ⚙ 按钮；每个 Section 加 SectionStatusBadge；AgentTimeline 面板头加 SseHealthDot
- `packages/web-ui/src/App.tsx` — 顶层包 ToastProvider
- `packages/web-server/src/server.ts` — 用 ConfigStore 替换 loadServerConfig 单次返回；挂 config 路由
- `packages/web-server/src/routes/overview.ts` — `analyzeOverviewDeps` 改收 `configStore`
- `packages/web-server/src/routes/case-plan.ts` — `orchestratorDeps` 改收 `configStore`
- 所有已有按钮（上传图、生成概览、编辑保存、批准、开跑、选 case、批准 case）替换为 ActionButton

## 4. 组件契约

### 4.1 ActionButton

```tsx
interface ActionButtonProps {
  onClick: () => Promise<void>;
  children: ReactNode;
  successMsg?: string;
  errorMsg?: (e: unknown) => string;
  variant?: "primary" | "danger" | "ghost";
  disabled?: boolean;
  className?: string;
}
```

**行为：**
- 点击立刻进 loading：`disabled=true` + spinner icon + 原文案
- `onClick` resolve → toast.success(`successMsg ?? "操作成功"`)；500ms 后退出 loading
- `onClick` reject → toast.error(`errorMsg?.(e) ?? String(e)`)；按钮下方 2 行红字回显，3s 后清除；退出 loading
- 禁止双击：loading 期间无视重复点击
- 3 种 variant：primary（蓝）、danger（红）、ghost（透明边框）

### 4.2 ToastProvider / useToast

- 顶层 Provider 放 App 下
- Hook API：`const toast = useToast(); toast.success(msg); toast.error(msg); toast.info(msg)`
- 容器：右上角 fixed，`z-50`，堆栈 `flex-col gap-2`
- 每条：颜色按类型（green-50/red-50/gray-50 + 对应边框）、文案、× 关闭按钮
- 自动消失：5 秒
- 最多同时 3 条，新到的挤走最老的

### 4.3 SseHealthDot

从 `useProjectStream` 读 `connectionState` 和 `lastEventTs`。

- 🟢 **connected**：EventSource `onopen` 触发过、未发生 error
- 🟡 **reconnecting**：`onerror` 发生后、`onopen` 重新触发前
- 🔴 **disconnected**：连续 3 次 `onerror` 且无 onopen 在中间

显示：一个 8×8 圆点 + tooltip（hover 显示完整状态 + `最近事件 N 秒前`）

### 4.4 SectionStatusBadge

```tsx
interface SectionStatusBadgeProps {
  sectionKey: "brief" | "mission" | "overview" | "case";
  projectStatus: string;
  activeAgents: ActiveAgent[];
  events: StreamEvent[];
}
```

**映射规则：**

| sectionKey | 对应 agent 前缀 |
|---|---|
| brief | `brief_analyst` |
| mission | `topic_expert.*`, `coordinator` |
| overview | `product_overview` |
| case | `case_expert.*`, `case_coordinator` |

**显示优先级（从高到低）：**
1. 该前缀下有 `status=online` agent → `[N/M 运行中 🟢]`（M=该 section 历史出现过的 agent 总数，N=当前运行数）
2. 最近 60s 内出现过该前缀 `.failed` 事件且未被覆盖 → `[失败 🔴]`
3. projectStatus 对应该 section 的 active states → `[进行中]`
4. 更早阶段 → `[completed]`（灰）
5. 更晚阶段 → `[待开始]`（浅灰）

### 4.5 SettingsDrawer

**触发：** 顶栏右侧 ⚙ 按钮。

**布局：** 右滑抽屉，宽 384px（`w-96`）。

**表单：**
- 上：**默认 CLI** 下拉（claude / codex）、**Fallback CLI** 下拉
- 中：**Agent 列表**，每行 `agent_key | cli 下拉 | model 文本框 | 删除按钮`。下拉值：claude / codex。Model 留空表示使用该 CLI 默认模型。
- 下："+ 添加 agent" 按钮（弹出 prompt 输入 agent_key）
- 底：**保存** (ActionButton) + **取消**（关抽屉）

**保存行为：** 
- PATCH `/api/config/agents` 带完整 shape
- 成功 → toast + 关抽屉
- 失败 → 抽屉内顶部红条显示错误

**打开时加载：** drawer `useEffect` → GET `/api/config/agents` 填表单。

## 5. 后端：ConfigStore + Routes

### 5.1 ConfigStore

```ts
// packages/web-server/src/services/config-store.ts
export interface AgentConfigPatch {
  defaultCli?: "claude" | "codex";
  fallbackCli?: "claude" | "codex";
  agents?: Record<string, { cli: "claude" | "codex"; model?: string }>;
}

export interface ConfigStore {
  readonly current: ServerConfig;
  update(patch: AgentConfigPatch): Promise<void>;
}

export function createConfigStore(path: string): ConfigStore;
```

**实现要点：**
- `current` 是 getter，每次读取返回最新 in-memory config
- `update` 合并 patch 到 current，原子写 config.json（写 tmp + rename），更新 in-memory
- 串行化：await 自然形成的序列即可，Node 单线程无并发写

**原子写：**
```ts
const tmp = path + ".tmp." + process.pid + "." + Date.now();
writeFileSync(tmp, JSON.stringify(raw, null, 2), "utf-8");
renameSync(tmp, path);
```

### 5.2 GET/PATCH /api/config/agents

```
GET /api/config/agents
→ { defaultCli: "claude", fallbackCli: "codex", agents: { "brief_analyst": { cli, model }, ... } }

PATCH /api/config/agents
body: AgentConfigPatch
→ 200 { ok: true }
→ 400 "invalid cli value" (if cli ∉ {claude, codex})
```

**校验：**
- `defaultCli` / `fallbackCli` / `agents[*].cli` 必须在 `["claude", "codex"]` 中
- agent key 不做格式限制（允许 `topic_expert.xxx`、`case_expert.xxx` 等点分）
- model 任意字符串（含空字符串表示 cli 默认）

### 5.3 路由改造

`overview.ts` 的 `OverviewDeps.analyzeOverviewDeps` 从：
```ts
{ vaultPath, sqlitePath, agents, defaultCli, fallbackCli }
```
改为：
```ts
{ vaultPath, sqlitePath, configStore: ConfigStore }
```

在 route handler 里 read：`const cfg = deps.analyzeOverviewDeps.configStore.current; ... agents: cfg.agents, defaultCli: cfg.defaultCli ...`。

`case-plan.ts` 的 `orchestratorDeps` 同样改造。

`server.ts` 创建一个 configStore 实例并把它注入两个路由。

## 6. 数据流

**按钮点击 → Toast：**
```
ActionButton.onClick
  → setLoading(true)
  → try await props.onClick()
      success → useToast().success(msg) + setLoading(false)
      error   → useToast().error(msg) + setErrorEcho + setLoading(false)
```

**SSE 健康：**
```
EventSource onopen  → setState("connected")
EventSource onerror → setState("reconnecting") → 3x 失败 → "disconnected"
每条 message       → setLastEventTs(now)
SseHealthDot render → 读 state + now - lastEventTs
```

**Section badge：**
```
projectStatus + activeAgents + events
  → filter 前缀匹配的 agent/event
  → 按优先级映射到 badge 文案/颜色
```

**模型切换：**
```
User 打开 SettingsDrawer
  → GET /api/config/agents   → 填表单
  → 修改 + 点保存
  → PATCH /api/config/agents → configStore.update()
    → atomic write config.json
    → in-memory cfg updated
  → 下一次 analyzeOverview / runCasePlan 启动时，route handler 从 configStore.current 读新值
```

## 7. 错误处理

- **PATCH 失败**：drawer 内顶部红条回显，按钮恢复；不改表单值
- **GET 失败**：drawer 显示"加载失败，点击重试"
- **config.json 写失败**（权限/磁盘满）：update 抛错，路由 500，内存不更新
- **SSE 断开**：UI 显示红点，不弹 toast（避免刷屏）；EventSource 浏览器自动重连
- **Agent 调用失败**：不变（走 orchestrator 的 failure 路径，`overview.failed` / `case_expert.failed` 事件 + FailureCard）

## 8. 测试策略

| 模块 | 类型 | 重点 |
|---|---|---|
| ActionButton | component | loading/spinner/error 回显/双击保护/成功 toast |
| ToastProvider + useToast | component | push/自动消失/最多 3 条/类型颜色 |
| SseHealthDot | component | 三种状态映射 |
| SectionStatusBadge | component | 5 种优先级场景快照 |
| SettingsDrawer | component | 读表单、改 CLI、提交 PATCH |
| ConfigStore | unit | update 合并、原子写、读回一致、并发序列化 |
| GET /api/config/agents | route | 返回当前 config |
| PATCH /api/config/agents | route | 验证 cli 枚举（400）、成功更新、GET 反映新值 |
| 集成：PATCH 后新 agent 调用取到新 cli | route | mock ModelAdapter，先 PATCH 再 POST /overview/generate，断言新 cli 被 resolveAgent 读到 |

保持 SP-03 的 162 测试不回归。

## 9. 性能与可观测性

- Toast 生命周期用 `setTimeout`，清理在 unmount 时 `clearTimeout`
- SettingsDrawer 打开前不 fetch config（避免首屏额外请求）
- ConfigStore 内存占用 < 1KB，原子写开销可忽略
- 如果 PATCH 频繁触发（不会，手动操作），config.json 写压力可接受

## 10. 回滚策略

- SettingsDrawer 改坏了可 revert 单文件
- ConfigStore 改动影响两个路由的 deps shape，若回滚需同步 revert 3 文件（config-store.ts、overview.ts、case-plan.ts、server.ts、routes/config.ts）
- 所有改动在一个 feature branch `sp03-5-polish`，合并前 squash 确保原子性

## 11. 交付物

1. 本 spec 提交 git
2. 实施计划 `docs/superpowers/plans/2026-04-13-sp03-5-ux-polish.md`
3. 约 10-12 个 TDD task（每个 task 一次 commit）
4. 完成后 smoke 一次（手动走一遍：点按钮看 toast、断网看红点、抽屉里切 claude/codex、新 agent 调用取到新 cli）

## 12. 估算

2-3 天工作量。

| 里程碑 | 任务 | 累计 |
|---|---|---|
| M1 ActionButton + Toast | Task 1-3 | ~0.5 天 |
| M2 SSE health + Section badge | Task 4-6 | ~1 天 |
| M3 ConfigStore + 路由改造 + SettingsDrawer | Task 7-11 | ~1-1.5 天 |
| M4 集成测试 + 替换所有现有按钮 | Task 12 | ~0.5 天 |

总计约 12 task。
