# SP-15 蒸馏加速设计 (Distillation Acceleration)

> Date: 2026-04-14
> Status: Draft
> Depends on: SP-06 (Style Distiller), SP-08 (Writer Tool Use), SP-10 (Role-Scoped Distillation / Config Workbench)

## 1. 动机

### 1.1 现状时间分布

SP-10 引入角色化蒸馏后，单篇文章的蒸馏流程（`packages/web-server/src/services/style-distill-role-orchestrator.ts`）如下，全部串行、全部默认 `claude-opus-4.6`：

| 阶段 | 平均耗时 | 默认模型 | 依赖 |
| --- | --- | --- | --- |
| slicer（切片 + 角色打标） | ~70s | opus-4.6 | article body |
| snippets（角色化片段抽取） | ~90s | opus-4.6 | slicer 输出 |
| structure（角色化结构归纳） | ~80s | opus-4.6 | slicer 输出 |
| composer（合并成 role profile） | ~60s | opus-4.6 | snippets + structure |
| **总计** | **~5 min / 篇** | | |

### 1.2 用户反馈

- 多位内测用户反映"蒸馏一篇要 5 分钟太慢，改一下提示词就要重跑很久"。
- 回溯场景下（调试 prompt、换角色、补蒸馏）体验尤其差。

### 1.3 目标

- 单篇首次蒸馏：< 3 分钟（降低 ~40%）。
- 单篇二次蒸馏（article body 未变）：< 90s（主要由 slicer 缓存贡献）。
- 不牺牲质量：snippets / structure / composer 仍默认 opus。
- 完全向前兼容 SP-08 / SP-10 的 `AgentConfigStore`。

## 2. 改动 1 — slicer 切换到 sonnet

slicer 任务简单：按段落边界分片、给每片打角色标签（观点/故事/金句/资料）。不需要 opus 的深度推理，sonnet-4.5 在此类结构化抽取上质量几乎无损且 ~3x 更快、更便宜。

### 2.1 实现

- `AgentConfigStore` 中 `section_slicer` agent 的默认 `model` 从 `claude-opus-4-6` 改为 `claude-sonnet-4-5`。
- `cli` 仍沿用 agent 全局默认（`claude` 或用户覆盖）。
- 用户可通过 Config Workbench (SP-10) 覆盖回 opus。
- orchestrator 读取 `agentConfigStore.resolve('section_slicer')` 得到 `{ cli, model }`，传给 slicer 调用。

### 2.2 迁移

- 首次启动时检测 `section_slicer.model` 是否为旧默认 opus 且未被用户显式改过 → 静默升级到 sonnet-4.5。
- 用户已手动设置的不动。

## 3. 改动 2 — snippets + structure 并行

snippets 和 structure 都只依赖 slicer 输出，彼此之间没有数据依赖，可安全 `Promise.all`。composer 依赖二者结果，保持在 `await` 之后执行。

### 3.1 orchestrator 代码改动

```ts
// style-distill-role-orchestrator.ts
const slices = await runSlicer(article, ctx);
emit('slicer_done', { article_id });

const [snippets, structure] = await Promise.all([
  runSnippets(slices, ctx).then(r => { emit('snippets_done', {...}); return r; }),
  runStructure(slices, ctx).then(r => { emit('structure_done', {...}); return r; }),
]);

const profile = await runComposer({ snippets, structure }, ctx);
```

### 3.2 并发度与节流

- 单篇内部并行度 = 2。
- 跨文章并行仍受 `maxConcurrentArticles`（SP-10 已有）限制。
- 若任一 promise 抛错：立刻 emit `phase_error`，取消整篇（不在本 spec 内做细粒度重试，交由用户 retry）。

### 3.3 SSE 顺序

- 事件顺序不保证 snippets_done 一定在 structure_done 之前——前端按 `phase` 字段分别更新对应卡片即可。

## 4. 改动 3 — slicer 缓存

slicer 的输出在 `(article body_plain, slicer prompt, slicer model)` 确定时完全确定（agent 本身有轻微随机性，但片段边界和角色标签在温度低时足够稳定；缓存命中即视为"确定性可接受"）。

### 4.1 缓存键

```
cache_key = sha256(slicer_model + "\n" + body_plain + "\n" + slicer_prompt_hash).slice(0, 16)
slicer_prompt_hash = sha256(readFile(slicer_prompt_path)).slice(0, 16)
```

### 4.2 存储位置

- `<vault>/08_experts/_cache/slicer/<cache_key>.json`
- 文件内容：
  ```json
  {
    "article_id": "uuid",
    "cache_key": "ab12...",
    "slicer_model": "claude-sonnet-4-5",
    "slicer_prompt_hash": "9f3d...",
    "slices": [ { "role": "...", "text": "..." } ],
    "cached_at": "2026-04-14T10:00:00Z"
  }
  ```

### 4.3 读写流程

1. orchestrator 进入 slicer 阶段前计算 `cache_key`。
2. `fs.stat` 命中 → 读 JSON，校验 `slicer_model` / `slicer_prompt_hash` 匹配 → 直接返回 slices，emit `slicer_cache_hit`。
3. 未命中或校验失败 → 正常调 LLM，成功后写缓存文件（`mkdir -p` + 原子写 tmp→rename）。
4. 写缓存失败不影响主流程（仅 warn log）。

### 4.4 失效

- slicer prompt 文件变更 → `slicer_prompt_hash` 变 → key 变 → 自然 miss。
- 切换 model → key 变 → miss。
- body_plain 变 → key 变 → miss。
- MVP 不做 LRU / TTL / 主动清理；用户可手动删 `_cache/slicer/`。

## 5. API / SSE 扩展

新增 SSE 事件：

```ts
type SlicerCacheHitEvent = {
  type: 'slicer_cache_hit';
  article_id: string;
  cache_key: string;
  cached_at: string;  // ISO
};
```

前端在 distill 进度条上将 slicer 阶段直接标记为完成（耗时显示 "cached"）。

## 6. 预期效果

单篇首次蒸馏（全部 miss）：

| 阶段 | 旧 | 新 | 节省 |
| --- | --- | --- | --- |
| slicer | 70s opus | 25s sonnet | -45s |
| snippets + structure | 90+80=170s 串行 | max(90,80)=90s 并行 | -80s |
| composer | 60s | 60s | 0 |
| **合计** | **300s** | **175s** | **-42%** |

单篇二次蒸馏（body 未变，slicer 命中）：

| 阶段 | 耗时 |
| --- | --- |
| slicer | ~0s (cache hit) |
| snippets + structure | 90s |
| composer | 60s |
| **合计** | **~150s** (-50%) |

## 7. 验收 (Acceptance)

- [ ] `section_slicer` 默认 model 升级到 `claude-sonnet-4-5`，旧用户首次启动时静默迁移（未自定义前提下）。
- [ ] Config Workbench 中可将 slicer 切回 opus，下次蒸馏生效。
- [ ] orchestrator 对 snippets + structure 使用 `Promise.all`，任一失败整篇失败；两路 SSE 事件都能到达前端。
- [ ] `_cache/slicer/<key>.json` 首次蒸馏后生成；二次蒸馏命中且耗时 < 1s。
- [ ] 修改 slicer prompt 文件后，二次蒸馏 miss，重新写入新 key 的缓存。
- [ ] SSE 新事件 `slicer_cache_hit` 可被前端消费，进度卡片显示 "cached"。
- [ ] 单篇 5000 字文章实测端到端 < 3 min（首次）、< 90s（二次）。
- [ ] 旧的 SP-10 集成测试全部通过，无回归。

## 8. 不在本 spec 范围

- composer 加速（后续可考虑 sonnet 或并行分块）。
- sqlite 缓存（MVP 用文件系统即可；量级 < 1万篇时 FS 足够）。
- LRU / TTL 缓存淘汰（保持无限保留，用户手动清理）。
- snippets / structure 缓存（收益低，prompt 更易迭代，留给后续）。
- 跨文章 slicer 复用（body 完全相同极少见，不做）。
