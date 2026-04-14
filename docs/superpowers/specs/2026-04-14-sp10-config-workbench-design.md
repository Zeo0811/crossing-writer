# SP-10 Role-Scoped Style Distillation + Config Workbench Design

**Status**: Approved (brainstorming 2026-04-14)
**Scope**: 引入「账号 × 角色」两维风格面板；新增顶栏「⚙️ 配置工作台」统一管理 agent 的 model / style / prompt / tools 绑定；支持项目级专属配置；蒸馏产物支持单角色重蒸 + 软删。

## 1. 动机

当前痛点：
- 风格蒸馏按"整账号"粒度出 1 份面板，writer-opening/practice/closing 共享 —— 风格不分角色，开场和实测段混在一起学
- agent 的 model / prompt / 工具开关分散在 `config.ts`、`expert-registry`、`writer-orchestrator` 等多处，没有统一入口
- 某项目想临时换风格或模型，只能改全局配置，影响别的项目
- 蒸馏面板、wiki 页、专家团在 UI 上各有独立页，缺一个总览和批量管理的地方

SP-10 用一个配置工作台 + 角色化蒸馏解决这四件事。选题专家团（topic-expert）留给 SP-12；段落手动编辑/插图留给 SP-13。

## 2. 核心概念

### 2.1 Role（角色）

MVP 三角色，与 writer agent 一一对应：

| role | agent | 含义 |
|---|---|---|
| `opening` | `writer.opening` | 开场段 |
| `practice` | `writer.practice` | 实测/case 展示段 |
| `closing` | `writer.closing` | 结尾总结段 |

角色清单 MVP 硬编码，SP-11+ 可改成配置化。

### 2.2 StylePanel（风格面板）

联合主键 `(account, role, version)`：
```yaml
# 08_experts/style-panel/<account>/<role>-v<n>.md
---
account: 十字路口
role: opening
version: 2
status: active        # active | deleted
created_at: 2026-04-14T10:00:00Z
source_article_count: 42
slicer_run_id: slicer-xxx
---

# opening 风格面板

## 句式特征
...
## 开场钩子常用类型
...
```

- 同 `(account, role)` 可有多个 version；永远指向 `status=active` 且最大 version 的那条
- 删除 = 软删（`status=deleted`），不物理移除；UI 里"清空已删"做彻底清理
- 旧 SP-06 的"整账号"面板标记 `role: legacy`，不参与绑定

### 2.3 AgentConfig（agent 配置）

```ts
interface AgentConfig {
  agentKey: string;                    // "writer.opening" / "writer.practice" / ...
  model: { cli: "claude" | "codex"; model: string };
  promptVersion?: string;              // e.g. "writer-opening@v1"
  styleBinding?: {                     // 仅 writer.* 有
    account: string;
    role: "opening" | "practice" | "closing";
  };
  tools?: {                            // 仅 writer.* 有
    search_wiki: boolean;
    search_raw: boolean;
  };
}
```

运行时 `styleBinding` 解引用：
```
styleBinding{十字路口, opening}
  → 查 StylePanel where account="十字路口", role="opening", status="active"
  → 取 max(version)
  → 注入到 agent prompt 的 [style panel] 区块
```

未找到 active 版本 → **阻断** agent 运行，SSE 返回 `writer.failed { reason: "style_not_bound" }`。

### 2.4 ProjectOverride（项目专属配置）

Sticky，存在项目目录下 `07_projects/<id>/config.override.yaml`：
```yaml
agents:
  writer.opening:
    model: { cli: codex, model: gpt-5 }
    styleBinding: { account: 花叔, role: opening }
  writer.closing:
    tools: { search_raw: false }
```

运行时合并顺序：`default agentConfig ← project override`（浅合并，override 字段优先）。

## 3. 架构

### 3.1 后端（packages/web-server）

新增 routes：
- `GET /api/config/agents` —— 返回全局 agentConfig 全部条目
- `PUT /api/config/agents/:agentKey` —— 更新某 agent 的 config
- `GET /api/config/style-panels` —— 列 `{account, role, version, status}[]`
- `POST /api/config/style-panels/distill` —— 触发 `(account, role)` 的蒸馏（内部串行跑 slicer + composer）
- `DELETE /api/config/style-panels/:id` —— 软删一个 version
- `GET /api/projects/:id/override` —— 读项目 override
- `PUT /api/projects/:id/override` —— 写项目 override

改动：
- `packages/web-server/src/services/agent-config-store.ts` —— 新 service，读 `~/.crossing/config.json#agents` + 提供 CRUD
- `packages/web-server/src/services/style-panel-store.ts` —— 新 service，扫 vault 目录 + 写新面板
- `packages/web-server/src/services/project-override-store.ts` —— 新 service，读写 `config.override.yaml`
- `packages/web-server/src/services/writer-orchestrator.ts` —— 调用时先合并 override + 解引用 styleBinding；未绑定 → 抛 `StyleNotBoundError`

### 3.2 Agents（packages/agents）

新 agent：`section-slicer`
- 输入：一篇 raw article body
- 输出：`[{start_char, end_char, role: "opening"|"practice"|"closing"|"other"}]`
- Prompt 让模型按段落级别分类，"other" 段（目录/致谢/广告）丢弃

改造 `style-distiller` 流程：
- 原 3 步（snippets → structure → composer）跑一次出 1 个 account-level 面板
- 新流程：`slicer → { role: opening } → snippets/structure/composer → opening panel` × 3 roles（并行）
- 3 轮各自独立产出 `(account, role, version)` 面板

### 3.3 前端（packages/web-ui）

新页面：
- `packages/web-ui/src/pages/ConfigWorkbench.tsx` —— 顶栏独立入口，侧栏两大板块（📝 主流程 / 🎨 蒸馏）
- `packages/web-ui/src/components/config/AgentCard.tsx` —— 单 agent 的配置卡（model / style / tools / prompt）
- `packages/web-ui/src/components/config/StylePanelList.tsx` —— 按 account × role 展示面板列表 + 操作
- `packages/web-ui/src/components/config/DistillModal.tsx` —— 触发蒸馏的弹窗（预计时间、slicer 步骤说明）
- `packages/web-ui/src/components/config/ProjectOverridePanel.tsx` —— 项目页侧边新增"项目专属配置"面板

顶栏：
- `packages/web-ui/src/components/TopNav.tsx` 新增 `[⚙️ 配置工作台]` 入口

项目运行时页：
- `ArticleSection.tsx` 顶部增加 `🎨 {account}/{role} v{N}` 标签，展示当前 agent 实际挂载的风格
- 未绑定 → 红色 `⚠️ style 未绑定` 按钮，点击跳配置工作台对应 agent 卡

## 4. 关键数据流

### 4.1 蒸馏一个 (十字路口, opening)

```
UI 点「去蒸」
  → POST /api/config/style-panels/distill { account: 十字路口, role: opening }
  → style-distiller orchestrator:
      1. SELECT body_plain FROM ref_articles WHERE account=十字路口 ORDER BY published_at DESC LIMIT 50
      2. 并行对每篇跑 section-slicer → 得到 (article_id, [{role, text}])
      3. 归堆：把所有 role=opening 的段合成一个大 corpus
      4. 跑 snippets agent → 句式/用词抽取
      5. 跑 structure agent → 开场结构模板
      6. 跑 composer agent → 合成 opening panel.md
      7. 写入 08_experts/style-panel/十字路口/opening-v2.md  (version = prev.max + 1)
      8. 把 prev v1 设为 status=deleted？  ❌ 不自动，保留历史
  → SSE 事件 distill.started → distill.slicer_progress → distill.composer_done
```

### 4.2 运行一个项目（阻断校验）

```
用户点"开始写作"
  → web-server 拿 project override + 全局 agentConfig → 合并
  → 对 writer.* 每个 agent 检查 styleBinding 是否有效（latest active 存在）
      → 任一缺失 → 不启动 orchestrator，SSE 返回 run.blocked { missingBindings: [...] }
  → 前端弹窗"以下 agent 未绑定风格：writer.closing"，[去补]
```

## 5. 数据结构

### 5.1 全局配置（`~/.crossing/config.json` 扩展）

```json
{
  "vaultPath": "~/CrossingVault",
  "agents": {
    "writer.opening": {
      "agentKey": "writer.opening",
      "model": { "cli": "claude", "model": "claude-opus-4.6" },
      "promptVersion": "writer-opening@v1",
      "styleBinding": { "account": "十字路口", "role": "opening" },
      "tools": { "search_wiki": true, "search_raw": true }
    },
    "writer.practice": { ... },
    "writer.closing":  { ... },
    "style-critic":    { "model": {...}, "promptVersion": "..." },
    "case-planner-expert": { ... }
  }
}
```

### 5.2 项目专属配置（`07_projects/<id>/config.override.yaml`）

```yaml
agents:
  writer.opening:
    model:
      cli: codex
      model: gpt-5
```

### 5.3 Style Panel 文件（`08_experts/style-panel/<account>/<role>-v<n>.md`）

```yaml
---
account: 十字路口
role: opening
version: 2
status: active
created_at: 2026-04-14T10:00:00Z
source_article_count: 42
slicer_run_id: slicer-xxx
composer_duration_ms: 45320
---

# 十字路口 · opening 风格面板 v2

## 钩子句式
...

## 节奏特征
...
```

## 6. 迁移方案

- SP-06 旧的 `08_experts/style-panel/<account>_kb.md` 启动时扫描到 → 附加 frontmatter `role: legacy`
- 旧格式不参与 styleBinding 解引用
- 配置工作台 UI 在 legacy 面板下显示「⚠️ 旧格式，不可绑定，请重蒸新版」

## 7. SSE 事件扩展

```
distill.started          { account, role, run_id }
distill.slicer_progress  { processed, total }
distill.snippets_done    { count }
distill.structure_done   { }
distill.composer_done    { panel_path }
distill.failed           { error }

run.blocked              { missingBindings: [{agentKey, reason}] }
```

前端 `useProjectStream` 需扩展 EVENT_TYPES 白名单。

## 8. 删除清单（SP-10 时一并清）

无删除 —— SP-10 是纯加量；SP-06 的原有蒸馏入口保留，只是出来的面板会自动带上新的 `role` 字段。

## 9. 验收

- [ ] 顶栏出现 `[⚙️ 配置工作台]`，点击进入配置页
- [ ] 配置页侧栏可切换「主流程 / 蒸馏」两大板块
- [ ] 每个 agent 卡展示 model / style / tools / prompt，可修改并保存
- [ ] 可为 `(十字路口, opening)` 蒸一次，出新面板 v1；再蒸得 v2；v1 不自动删
- [ ] 面板列表可软删某 version；软删后同 role 的 latest active 指向 v1（若还有）
- [ ] 未绑定 writer.closing 时运行项目 → 阻断 + 红字提示
- [ ] 在项目里设置专属配置 → 全局默认不变，关项目再开后生效依旧
- [ ] 旧 SP-06 面板显示为 `legacy`，不能绑
- [ ] 主流程运行时段落卡片显示当前挂载的 `account/role vN`
- [ ] slicer 能把一篇文章段落正确打 opening/practice/closing/other 标签

## 10. 不在本 spec 范围

- topic-expert 接入 + 选题专家团（→ SP-12）
- CLI 健康灯（→ SP-11）
- 段落手动编辑 + 插图（→ SP-13）
- 角色清单的运行时增删（MVP 硬编码）
- 蒸馏的增量/断点续跑（整次 re-run）
- prompt 编辑器 UI（MVP 只显示版本号，点「编辑」跳文件浏览即可）
