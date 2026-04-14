# SP-12 Topic-Expert Team Integration

**Date**: 2026-04-14
**Status**: Draft
**Depends on**: SP-02 Mission Workbench, SP-03 Case Plan Workbench, SP-10 Config Workbench

## 1. 动机

`packages/agents/src/roles/topic-expert.ts` 作为 agent role 已存在（round1 打分 / round2 结构设计 / round3 续写 prompt），但**从未接入任何 web-server 路由**，前端也无法调用。与此同时，vault 已沉淀 `08_experts/topic-panel/` 目录，里面有 10 位选题专家 KB（赛博禅心、数字生命卡兹克、苍何 等），`index.yaml` 汇总，`SKILL.md` 说明使用方式。

用户在解析完 brief 后需要**主动勾选若干位选题专家**对本项目进行：

- **打分**：从各自视角为选题打分 + 给理由
- **结构**：为本项目设计一个适配的文章结构
- **续写**：基于当前 draft 以该专家的口吻续写一段

并希望在 **Config Workbench** 统一管理专家团（active 开关、specialty 编辑、蒸馏/重蒸/软删硬删/新增），与 SP-10 既有模式一致。

## 2. 核心概念

| 概念 | 定义 |
| --- | --- |
| `TopicExpert` | 一位选题专家，对应 `08_experts/topic-panel/experts/<name>_kb.md` 一份文件，含 specialty / 风格速写 / 代表作拆解 |
| `TopicExpertIndex` | `08_experts/topic-panel/index.yaml`，列出所有专家 + `active` + `default_preselect` + `specialty` |
| `TopicExpertInvocation` | 一次召唤动作：`selected: string[]` + `invokeType: 'score' \| 'structure' \| 'continue'` + `context` |
| `InvocationResult` | 每位 expert 独立返回一份 markdown，最终合并为 panel 输出 |

## 3. 架构

```
[Vault: 08_experts/topic-panel/]
        ├── index.yaml          ← TopicExpertStore 读写
        ├── SKILL.md
        └── experts/
             ├── 赛博禅心_kb.md
             ├── 数字生命卡兹克_kb.md
             └── …(10 份)

[web-server]
  TopicExpertStore  ──┬── GET  /api/topic-experts
                      ├── GET  /api/topic-experts/:name
                      ├── PUT  /api/topic-experts/:name
                      ├── POST /api/topic-experts        (新增)
                      ├── DELETE /api/topic-experts/:name (软/硬删)
                      └── POST /api/projects/:id/topic-experts/consult (SSE)

[agents]
  topic-expert.ts  ←  orchestrator parallel-map selected experts

[web-client]
  Config Workbench 侧栏新增「🧑‍🎓 选题专家团」
  Project Page Step 1 新增「🗂 召唤选题专家团」按钮
```

### 3.1 Backend — TopicExpertStore

- 启动时扫描 `<vault>/08_experts/topic-panel/index.yaml`，若缺失则根据 `experts/*.md` 文件名初始化。
- 每位 expert 的 KB md 文件前 frontmatter 解析 `name / specialty / active / default_preselect / soft_deleted`。
- 所有写入走 vault git commit（复用 SP-01 vault writer）。

### 3.2 Orchestrator

```
consult(projectId, { selected, invokeType, context }) {
  emit('topic_consult.started', { selected, invokeType });
  await Promise.all(selected.map(async name => {
    emit('expert_started', { name });
    try {
      const kb = await store.read(name);
      const out = await runTopicExpertAgent({ kb, invokeType, context });
      emit('expert_done', { name, output: out });
    } catch (e) {
      emit('expert_failed', { name, error: e.message });
    }
  }));
  emit('all_done');
}
```

并发上限 3（防止模型 QPS 超限），超出排队。

### 3.3 Agent reuse

`topic-expert.ts` 已有三段 prompt，新增 `invokeType` 入参切换 round1/2/3。KB 内容以 system prompt 注入，project context（brief + case plan 摘要）以 user prompt 注入。

## 4. API 契约

### 4.1 List

```
GET /api/topic-experts
→ 200 { experts: [
    { name, specialty, active, default_preselect, soft_deleted, updated_at }
  ] }
```

### 4.2 Detail

```
GET /api/topic-experts/:name
→ 200 { name, specialty, active, default_preselect,
         kb_markdown, word_count, distilled_at }
```

### 4.3 Update (toggle / edit)

```
PUT /api/topic-experts/:name
  body { active?, default_preselect?, specialty?, kb_markdown? }
→ 200 { ok:true, expert }
```

### 4.4 Create

```
POST /api/topic-experts
  body { name, specialty, seed_urls?: string[] }
→ 202 { job_id }  # 触发蒸馏，复用 SP-10 蒸馏管线
```

### 4.5 Delete

```
DELETE /api/topic-experts/:name?mode=soft|hard
→ 200 { ok:true, mode }
```

### 4.6 Consult (SSE)

```
POST /api/projects/:id/topic-experts/consult
  body { selected: string[], invokeType: 'score'|'structure'|'continue',
         context?: { selection?: string, focus?: string } }
→ text/event-stream
  event: topic_consult.started / expert_started / expert_done
       / expert_failed / all_done
```

## 5. 数据结构

### 5.1 index.yaml

```yaml
version: 1
updated_at: 2026-04-14T10:00:00Z
experts:
  - name: 赛博禅心
    specialty: AI 哲思 / 东方视角 / 科技禅学
    active: true
    default_preselect: true
  - name: 数字生命卡兹克
    specialty: AI 产品拆解 / 工程化叙事
    active: true
    default_preselect: false
  - name: 苍何
    specialty: 出海 & AI 产品观察
    active: true
    default_preselect: false
    soft_deleted: false
```

### 5.2 Expert KB frontmatter

```yaml
---
name: 赛博禅心
specialty: AI 哲思 / 东方视角
distilled_from: [wx://xxx, url://yyy]
distilled_at: 2026-04-12T…
version: 3
---
# 风格速写
…
# 代表作拆解
…
# 用语习惯
…
```

## 6. UI

### 6.1 Config Workbench 新侧栏项「🧑‍🎓 选题专家团」

- 表格列：`name / specialty(可编辑) / active toggle / default_preselect toggle / 最后蒸馏时间 / 操作`
- 操作栏：`[查看KB] [重蒸] [软删] [硬删]`
- 顶部：`[+ 新增专家]` 弹窗要求输入 name + 可选 seed URLs，触发蒸馏 job
- 复用 SP-10 `DistillModal` 组件（mode=`topic_expert`）

### 6.2 Project Page — Step 1 Brief 解析后

- 新增按钮 `[🗂 召唤选题专家团]`
- 点击弹窗：
  - 顶部切换 `invokeType` tabs: `打分 / 结构 / 续写`
  - 专家 checkbox 列表：默认勾中 `active=true && default_preselect=true` 的专家
  - 每位显示 `name` + `specialty` 一行摘要
  - 底部 `[开始召唤]`
- 提交后进入 SSE 流式视图：
  - 顶部进度条 `3 / 5 专家已完成`
  - 每位 expert 一张卡片，流式渲染其 markdown 输出
  - 失败的 expert 显示红色错误 + `[重试]`
  - 全部完成后底部 `[保存到项目笔记]` 写入 `projects/<id>/topic-expert-panel.md`

### 6.3 输出展示 pattern

复用 SP-03 case-plan 的 SSE 卡片渲染组件（`<StreamingMarkdownCard>`），改造为支持多卡片并行流。

## 7. 蒸馏 / 重蒸 / 新增 / 软硬删

全部复用 SP-10 配置工作台已有能力：

| 操作 | 触发 | 行为 |
| --- | --- | --- |
| 新增专家 | `POST /api/topic-experts` | 启动 wiki-ingestor (SP-07) + style-distiller (SP-06) 管线，生成 KB md |
| 重蒸 | 专家卡片 `[重蒸]` | 重新跑蒸馏，`version++`，旧 KB 入 `.bak` |
| 软删 | `DELETE …?mode=soft` | `soft_deleted: true`，列表变灰，不参与召唤 |
| 硬删 | `DELETE …?mode=hard` | 从 index.yaml 移除 + md 文件入回收站目录 |

Agent 允许调用的配置 key：`topic_expert.<name>`（SP-10 已允许该 pattern）。

## 8. SSE 事件

| event | payload |
| --- | --- |
| `topic_consult.started` | `{ invokeType, selected: string[] }` |
| `expert_started` | `{ name }` |
| `expert_delta` | `{ name, chunk }`（流式增量） |
| `expert_done` | `{ name, markdown, tokens }` |
| `expert_failed` | `{ name, error }` |
| `all_done` | `{ succeeded: string[], failed: string[] }` |

## 9. 验收

- [ ] `GET /api/topic-experts` 返回 10 位专家，active/default_preselect 字段正确
- [ ] Config Workbench 能切 active 开关，vault `index.yaml` commit 可见
- [ ] Config Workbench `[查看KB]` 能渲染 md
- [ ] `[新增专家]` 走完 ingestor→distiller 管线，生成 `<name>_kb.md`
- [ ] `[重蒸]` 保留 `.bak`，`version` 递增
- [ ] 软删后该 expert 不出现在项目页召唤弹窗
- [ ] 项目页 `[🗂 召唤选题专家团]` 默认勾中 `default_preselect` 为 true 的专家
- [ ] `invokeType=score/structure/continue` 三种均能流式返回结果
- [ ] 其中一位 expert 失败不阻塞其他（fail-isolated）
- [ ] 全部完成后 `[保存到项目笔记]` 写入 `projects/<id>/topic-expert-panel.md`

## 10. 不在本 spec 范围（留后续）

- **专家之间的辩论 / 二轮互评**：当前版本每位 expert 独立输出，不做 expert-to-expert 互评。
- **跨项目的专家偏好学习**：如"数字生命卡兹克 对 AI 产品类选题历史平均分 8.7"这类聚合统计。
- **角色 mix**：将 topic-expert 与 writer / editor 等其他 role 混编成团队（留给 SP-13 Multi-Role Council）。
- **用户自定义 invokeType**：当前硬编码三种，自定义 prompt 模板留后续。
