# SP-C · Config 简化（数据模型 + UI）

## 背景

当前 config 面板负担过重，主要毛病：

1. `AgentsPanel` 渲染 16 个 `AgentCard`，每个都能选 model。实际大部分 agent 用同一套 model，per-agent 粒度没用。
2. `reference_accounts_per_agent` 字段残留 —— 早期写作架构的产物。现在 writer agent 的风格通过 `styleBinding` → StylePanel 解析，`reference_accounts` 在 prompt 里被当成「参考账号风格素材」重复塞，价值不大且和 StylePanel 重叠。
3. ConfigWorkbench 有 4 个 Tab：Agent 团 / 模型 CLI / 工具集 / 选题专家。后两个（模型 CLI、工具集）是只读状态面板，不是 config。

## 目标

把 config 的有效字段从「16 agent × (model + refs + tools + binding)」缩到：

- 2 个全局模型选择（writer / 非 writer）
- writer 的 styleBinding（保留，writer 专用）
- writer 的 tools 开关（保留）

UI 从 4 个混乱 tab 缩到 2 个（基础 / 状态），其余内容（风格面板、硬规则、选题专家）挪到侧栏独立入口。

## 范围

**在：**

- config 数据模型新增 `default_model: { writer, other }`；移除 `AgentConfigEntry.model` 和 `AgentConfigEntry.reference_accounts`
- `ProjectOverride` 相应缩减：只留 `default_model?`（`writer?` / `other?`）和 `agents?`（styleBinding / tools 这些 writer-specific override）
- 代码层新增 `resolveModelForAgent(agentKey): { cli, model }` —— agent 以 `writer.` 开头走 `default_model.writer`，其余走 `default_model.other`
- 全量清理 `reference_accounts` 链路：`writer-orchestrator.ts` 的 `loadReferenceAccountKb` / `refsBlock` / 所有 `buildXxxUserMessage(..., refs)` 参数、route 层 `loadRefs`、`AgentConfigEntry.reference_accounts`、后端 API payload
- ConfigWorkbench 重构：4 tab → 2 tab（基础 + 状态）；基础 tab 只渲染 2 个下拉 + writer styleBinding 列表；状态 tab 保留 CLI 健康 + 工具集只读列表
- 侧栏新增 3 个独立入口：风格面板 / 硬规则 / 选题专家（`StylePanelsPage` / `WritingHardRulesPage` 本来就存在，只是从 config tab 挪到顶级）
- 旧 config 自动迁移：首次 read 时若 `default_model` 缺失，从任意一个 `writer.*` agent 的 `model` 推断 writer，从任意非 writer agent 推断 other，写回 config

**不在：**

- styleBinding 的数据形态（继续 per-writer-agent）
- writing-hard-rules.yaml
- project-level override 的非 model 部分
- publisher / knowledge / vault 这些页面
- 顶部导航的整体视觉风格（只是加 3 个入口）
- 任何 prompt 改动（refs 字段从 prompt 里删后，user message 里「# 参考账号风格素材」整段直接去掉）

## 决策

### 为什么 writer / other 两档

用户明确选 B：writer 吃最重（常配 opus），其他 agent（brief analyst / case planner / stitcher / critic）用 sonnet 就够。

- **Why**：成本和延迟的最大拖累在 writer，把 writer 单独升档足够覆盖 90% 的使用场景。更细粒度的 per-agent override 几乎没人用。
- **How to apply**：resolver 只看 agentKey 前缀。未来若需要更细，加一层命名约定即可。

### 为什么 reference_accounts 彻底删而不是 hidden

字段本身冗余 —— `styleBinding` → `StylePanel` 才是 writer 风格的权威源。reference_accounts 出现在 prompt user message 里时叫「# 参考账号风格素材」，实测里这块内容经常是空或跟 StylePanel 重复。保留只会继续造成两个来源互相冲突。

### 为什么侧栏抽出而不是做子菜单

「风格面板」「硬规则」「选题专家」本质上是 knowledge-level 配置（vault 维度），不属于 project-level writer 配置。当前塞在 config tab 里是历史遗留。侧栏独立入口更符合 IA。

### Config UI 2 tab 而不是完全无 tab

**基础**：每天可能改的字段（全局 model 两档 + writer styleBinding）；
**状态**：只读（CLI 健康、tool 列表），看一眼确认环境 OK。

分开让"我要改东西"和"我要看状态"两种心智模式清晰。

## 架构

### 数据模型

```ts
// packages/web-server/src/services/config-store.ts
interface AppConfig {
  version: 1;
  vaultPath: string;
  sqlitePath: string;
  // 新增：
  default_model: {
    writer: { cli: 'claude' | 'codex'; model?: string };
    other:  { cli: 'claude' | 'codex'; model?: string };
  };
  // existing fields untouched...
}
```

```ts
// packages/web-server/src/services/agent-config-store.ts
interface AgentConfigEntry {
  agentKey: string;
  // model 字段移除 — 改成用 resolveModelForAgent
  promptVersion?: string;
  styleBinding?: AgentStyleBinding;   // writer.* 专用
  tools?: AgentToolsConfig;           // writer.* 专用
  // reference_accounts 字段移除
}

// 新增 resolver
export function resolveModelForAgent(
  agentKey: string,
  defaultModel: AppConfig['default_model'],
): { cli: 'claude' | 'codex'; model?: string } {
  if (agentKey.startsWith('writer.')) return defaultModel.writer;
  return defaultModel.other;
}
```

### 旧 config 自动迁移

`ConfigStore.read()` 加一步：若 parsed config 没有 `default_model`，从现有 `AgentConfigEntry` 里推断：

```ts
// Pseudo — migration is one-shot on first read of old config
async read(): Promise<AppConfig> {
  const raw = parseYaml(await readFile(this.filePath));
  if (!raw.default_model) {
    const agents = await this.agentConfigStore.all();
    const writerAgent = agents.find((a) => a.agentKey.startsWith('writer.'));
    const otherAgent  = agents.find((a) => !a.agentKey.startsWith('writer.'));
    raw.default_model = {
      writer: writerAgent?.model ?? { cli: 'claude', model: 'claude-opus-4-6' },
      other:  otherAgent?.model  ?? { cli: 'claude', model: 'claude-sonnet-4-5' },
    };
    // delete model + reference_accounts from each AgentConfigEntry
    for (const a of agents) {
      delete a.model;
      delete a.reference_accounts;
      await this.agentConfigStore.write(a);
    }
    await this.write(raw);
  }
  return raw;
}
```

迁移后旧 agent config 里 `model`、`reference_accounts` 字段消失；新启动读到的就是纯净的新格式。

### UI

```
App layout:
  Sidebar
    ├── 项目（ProjectList）
    ├── 配置（ConfigWorkbench · 2 tab）
    ├── 风格面板（StylePanelsPage）         ← 新入口（原在 config tab 内被移除）
    ├── 硬规则（WritingHardRulesPage）       ← 新入口
    ├── 选题专家（TopicExpertPage）          ← 新入口（原在 config tab 内）
    ├── 知识库（KnowledgePage）
    └── 设置（SettingsPage）

ConfigWorkbench:
  Tab · 基础
    ┌─ 模型
    │   [Writer model dropdown]   [Other model dropdown]
    ├─ Writer 风格绑定
    │   writer.opening  → [StylePanel picker]
    │   writer.practice → [StylePanel picker]
    │   writer.closing  → [StylePanel picker]
    └─ Writer Tools
        search_wiki [x]  search_raw [x]  (per-writer-agent checkbox row)

  Tab · 状态
    ┌─ CLI
    │   🟢 claude v1.4.2   🟢 codex v0.9.1
    └─ 工具集
        (writes: tool list with attached-agents labels — read only)
```

### Writer 调用链改动

`writer-orchestrator.ts` 的 `resolve(key, cfg)` 改成：

```ts
function resolve(key: WriterAgentKey, defaultModel: AppConfig['default_model']) {
  return {
    ...resolveModelForAgent(key, defaultModel),
    // refs 彻底去掉
  };
}
```

调用点 `buildOpeningUserMessage(briefSummary, missionSummary, productOverview, refs)` / `buildPracticeUserMessage(...)` / `buildClosingUserMessage(...)` / `buildCriticUserMessage(...)` 全部从 signature 里移除 `refs` 参数，对应 user message 模板里 `# 参考账号风格素材\n${refsBlock(refs)}` 整段删掉。

`loadReferenceAccountKb` 函数整个删除。

route 层 `packages/web-server/src/routes/writer.ts` 同样清理 `loadRefs` 和调用点。

## 组件细节

### `resolveModelForAgent` 单元测试

- agentKey `writer.opening` → `default_model.writer`
- agentKey `writer.practice` → `default_model.writer`
- agentKey `brief_analyst` → `default_model.other`
- agentKey `case_coordinator` → `default_model.other`
- agentKey `style_distiller.composer` → `default_model.other`
- agentKey `practice.stitcher` → `default_model.other`（不是 `writer.` 前缀，小心）

### Migration 单元测试

- 老 config（无 `default_model`，agent 们有 `model`）→ 迁移后有 `default_model`，agent 们没 `model`
- 老 config 里 writer agent 指向 opus，other 指向 sonnet → migration 后 default_model.writer=opus，default_model.other=sonnet
- 迁移后的 config 再读一次 → 不重复迁移（幂等）
- reference_accounts 字段在任何 agent 里出现 → 迁移后消失

### UI 回归测试

- `ConfigWorkbench.test.tsx`：渲染只有 2 个 Tab；没有 16 个 AgentCard
- 侧栏渲染 3 个新入口（风格面板 / 硬规则 / 选题专家）
- 全局 model 改动 → 点保存 → `/api/config`（或新端点）收到 `default_model` payload

## 数据流

```
[启动]
  ConfigStore.read()
    ├── 新格式 → 返回
    └── 旧格式 → migrate → 写回 → 返回新格式

[Writer run 开始]
  orchestrator.resolve(agentKey, appConfig.default_model)
    ├── agentKey.startsWith('writer.') → writer model
    └── 其他 → other model
  No more refs lookup. No more refs block in user message.

[UI 改 model]
  ConfigWorkbench 基础 tab → 下拉 change → PUT /api/config { default_model }
  ConfigStore.write() → 持久化

[UI 改 styleBinding]
  同现在（每个 writer agent 一个 picker）→ PUT /api/config/agents/:key
```

## 错误处理

- 迁移时 `agentConfigStore` 读不到任何 agent → 用硬编码默认（claude opus / claude sonnet），不阻塞启动
- `default_model.writer.cli` 是 `codex` 但 codex 健康检查失败 → 继续写作（`invokeAgent` 自己会 fallback 或报错），config 层不做健康前置校验
- 旧代码引用 `AgentConfigEntry.model` → 类型层面一律改成 `AgentConfigEntry['model']?` 临时保留或直接删（推荐删，迁移后就不该出现）

## 测试

### 单元

- `agent-config-store.test.ts`：migrate one-shot + idempotency；`resolveModelForAgent` 前缀路由；`AgentConfigEntry` 新 shape
- `config-merger.test.ts`：project override 合并顺序（project > app default）

### 集成

- `writer-orchestrator.test.ts`：resolve 按 agentKey 前缀走 default_model；不再读 reference_accounts
- `writer.ts` route tests：rewrite / start 路径都走新 resolver

### UI

- `ConfigWorkbench.test.tsx`：2 tab，基础 tab 渲染 2 下拉 + binding list + tools
- `AgentsPanel` 文件整个删除（连测试一起）

## 风险

| 风险 | 缓解 |
|---|---|
| 老 config 迁移错 model | 迁移代码抄了第一个 writer agent 的 model；测试覆盖无 writer agent 的 degenerate case |
| UI 迁移后找不到"选题专家" tab | 侧栏新加入口有标签 + 保留 ConfigWorkbench 里的 redirect 提示 1 个 release 周期 |
| 删掉 refs 后 writer 质量下降 | 迁移前 B.2/B.3 已经通过 styleBinding 拉齐 writer 的风格骨架；实测 trae 已验证 |
| 旧 API `POST /api/config/agents/:key { model }` 还有 caller | 这条 API 在新 shape 下依然有效（改成 styleBinding / tools），但会 ignore `model` 字段；给 deprecation warning 一次 |

## 非目标 / 未来

- 三档模型（比如 super-writer / writer / other）
- per-project full AgentConfigEntry override
- Config UI 的全局搜索
- styleBinding 从 per-agent 收敛到 per-account（one account → 系统自动按角色解析 panel）— SP-D

## 验收标准

### 代码验收

- `pnpm -r test` 全绿（除已 flagged 的 3 个 pre-existing failures）
- `pnpm -r typecheck` 无新增错误
- `grep -r "reference_accounts" packages/` 零命中
- `grep -r "refsBlock\|loadReferenceAccountKb" packages/` 零命中

### 实测验收

- 用一个旧 config 启动 → 自动迁移 → 写成新格式
- ConfigWorkbench 打开只看到 2 tab
- 侧栏 3 个新入口可用
- 改全局 writer model → 所有 writer.* agent 在下次 run 都走新 model
- 跑一次 trae writer rewrite → 生成质量不掉（字数、禁用词依旧过 B.3 validation）

---

## Validation log

- **2026-04-17**: Trae project smoke test passed SP-C acceptance.
  - Config migration: `config.json` auto-migrated on first `loadServerConfig` — `defaultModel: { writer: {cli: claude, model: claude-opus-4-6}, other: {cli: claude, model: sonnet} }` populated; per-agent `model` + `reference_accounts` fields purged from agents ✓
  - `GET /api/config/agents` returns `defaultModel` at top level ✓
  - `PATCH /api/config/agents` with `{ defaultModel: { writer: {cli, model} } }` accepted; validator rejects malformed cli (covered by 6 new tests in routes-config-agents.test.ts)
  - Trae opening rewrite via `POST /api/projects/trae/writer/sections/opening/rewrite`: `writer.validation_passed` attempt=1, chars=379 ∈ `[160, 480]` tolerance band ✓ — B.3 validator still intact
  - Final opening: zero `不是X而是Y`, zero `笔者`/`本人`, zero em-dashes; no `# 参考账号风格素材` header in rendered prompt ✓
  - Grep audit: zero `cli_model_per_agent` / `loadReferenceAccountKb` / `refsBlock` / `loadRefs` in `packages/web-server/src` + `packages/agents/src` ✓
  - ConfigWorkbench UI: 2 tabs (基础 + 状态); AgentsPanel + AgentCard deleted ✓
  - TopNav: 5 entries (Projects / 风格面板 / 硬规则 / 选题专家 / 配置) ✓
- **Task 7 correction**: Initial Task 7 commit touched `routes/config.ts` which is not registered in `server.ts`. Corrected in follow-up commit `a54fd52` — moved `defaultModel` GET/PATCH handlers to the active `routes/config-agents.ts`, deleted the dead legacy file.
