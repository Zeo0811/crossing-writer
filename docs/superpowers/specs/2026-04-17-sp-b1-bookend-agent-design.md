# SP-B.1: 合并 Opening + Closing Agent 设计文档

**创建日期**: 2026-04-17
**作者**: zeoooo + Claude
**状态**: 设计已确认，待实施
**前置**: SP-A（`feat/sp-a-style-distill-v2` 分支）

## 背景

SP-A 交付了 v2 panel 和全局 writing hard rules。Writer 现在已经吃到 panel 里的 `## <role> · <type>模式` section，但 opening / closing 两个 agent 结构仍然高度重复：

- `packages/agents/src/roles/writer-opening-agent.ts` ≈ 70 行
- `packages/agents/src/roles/writer-closing-agent.ts` ≈ 70 行，跟 opening 几乎对称
- 各自独立的 prompt 文件、几乎相同的 brief / mission / panel 注入逻辑

两个 agent 的任务本质都是"根据 panel 的 type section 写一段创作性框架句"。合并成一个 `writer-bookend-agent`，用 `role: 'opening' | 'closing'` 参数区分，可以：

- 减 ~60 行代码（去一个 agent 文件）
- 删掉 1 个 prompt 文件，合并到 `writer-bookend.md`
- 把公共的 panel / hard rules / context 注入逻辑抽到 `writer-shared.ts`，一处改两处生效
- 后续加硬约束（B.2）/ validator（B.3）时只改一份 prompt

**不在本 spec 范围**：

- B.2（把字数 / 禁用句式的强制引用加进 prompt）——下个迭代
- B.3（post-write validator + 自动 retry）——再下一个迭代
- Practice agent / stitcher / style critic——不动
- Case 阶段任何 agent——不动

## 架构决策

### 决策 1：合并形态（方案 X）

Opening 和 closing **仍然是 2 次独立 LLM call**，但：

- 共用一个 agent class（`writer-bookend-agent`）
- 共用一份 prompt 文件（`writer-bookend.md`），内部用 `{{#if role === 'opening'}}...{{/if}}` 分支
- 共用 panel 查询、hard rules 渲染、context bundle 注入逻辑（通过 `writer-shared.ts`）

**放弃方案 Y**（一次 call 同时出 opening + closing）：token 省 ~40% 但质量独立性丢失，输出格式解析脆弱，收益不抵风险。

### 决策 2：Stitcher 不合并（选项 c）

`practice.stitcher` 输入不一样（读 4 个 case 的正文写衔接），合进来要么 prompt 模板长一堆 `{{#if}}` 分支，要么 stitcher prompt 被稀释。保留独立。

公共辅助函数（panel 查询、硬规则渲染）单独抽到 `writer-shared.ts`，stitcher / practice / bookend 都能用。

### 决策 3：Skill 调用保留并强制

保留 `search_wiki` / `search_raw` 的 tool runner 集成（通过 `runWriterWithTools`）。

**新增强制要求**：prompt 里明写"写正文前必须调用 search_wiki 和 search_raw 各至少一次"。空结果的兜底：继续写，段首加 `<!-- no wiki/raw hits -->` 注释，便于人工复查。

### 决策 4：模板引擎

手写 regex replace（`{{placeholder}}` + `{{#if role === 'opening'}}...{{/if}}`）。不引 `mustache` / `handlebars`：

- 模板复杂度低，不到 20 个 placeholder
- 避免新增 npm 依赖
- `writer-shared.ts` 写 `renderBookendPrompt(opts)` 和 `extractSubsection(section, name)` 两个小函数就够

### 决策 5：旧 agent 直接删

不保留 `runWriterOpening` / `runWriterClosing` / `WriterOpeningAgent` / `WriterClosingAgent` 作为 deprecated export。这是 monorepo 内部包，无外部 caller。一次性删干净。

## 文件结构

### 新增

```
packages/agents/src/roles/
  writer-bookend-agent.ts        # runWriterBookend({role, ...})
  writer-shared.ts                # renderBookendPrompt, extractSubsection, renderHardRulesBlock

packages/agents/src/prompts/
  writer-bookend.md               # 合并 writer-opening.md + writer-closing.md

packages/agents/tests/
  writer-bookend-agent.test.ts    # mock LLM, 两个 role 分支各覆盖
  writer-shared.test.ts           # pure-function 测试
```

### 修改

```
packages/agents/src/index.ts      # 导出 runWriterBookend; 删除 runWriterOpening/runWriterClosing 的 export
packages/web-server/src/services/writer-orchestrator.ts  # 调用改成 runWriterBookend
```

### 删除

```
packages/agents/src/roles/writer-opening-agent.ts
packages/agents/src/roles/writer-closing-agent.ts
packages/agents/src/prompts/writer-opening.md (如果存在)
packages/agents/src/prompts/writer-closing.md (如果存在)
packages/agents/tests/writer-opening-agent.test.ts (如果存在)
packages/agents/tests/writer-closing-agent.test.ts (如果存在)
```

## 数据流

```
writer-orchestrator.ts
    ├─> runWriterBookend({ role: 'opening', panel, hardRules, ... })
    │       ├─> renderBookendPrompt(role='opening', panel, hardRules)
    │       │       extracts panel.types[实测].opening subsection,
    │       │       injects hard rules block,
    │       │       fills {{account}} / {{article_type}} / {{role中文}} placeholders
    │       ├─> runWriterWithTools({
    │       │       systemPrompt: renderedPrompt,
    │       │       dispatchTool: search_wiki / search_raw,
    │       │       ...
    │       │   })
    │       └─> returns { finalText, toolsUsed, rounds }
    └─> runWriterBookend({ role: 'closing', ... })  # 同上，role 不同
```

Event stream unchanged：

- `writer.section_started { section_key: 'opening', agent: 'writer.opening' }`
- `writer.section_started { section_key: 'closing', agent: 'writer.closing' }`
- `writer.tool_called / tool_returned` 等

UI 无需改。

## Prompt 完整模板

`packages/agents/src/prompts/writer-bookend.md`：

```markdown
# Writer · Bookend（开头 / 结尾）

你是「{{account}}」风格的一篇文章的写手。本次任务只写**一段**：
{{#if role === 'opening'}}**开头**{{/if}}{{#if role === 'closing'}}**结尾**{{/if}}。

## 当前任务

{{#if role === 'opening'}}
写**开头**。
- 目标：{{panel.目标}}
- 字数硬约束：**{{panel.word_count_ranges.opening}} 字**（超或不足都要重写）
- 可用结构骨架（三选一，从 panel 现学现用）：

{{panel.结构骨架}}

- 高频锚词（用，不是照抄）：{{panel.高频锚词}}
- 禁止出现：{{panel.禁止出现}}
- 参考示例（3 条真实样本，学节奏）：

{{panel.示例}}
{{/if}}

{{#if role === 'closing'}}
写**结尾**。
- 目标：{{panel.目标}}
- 字数硬约束：**{{panel.word_count_ranges.closing}} 字**
- 可用结构骨架：

{{panel.结构骨架}}

- 高频锚词：{{panel.高频锚词}}
- 禁止出现：{{panel.禁止出现}}
- 参考示例：

{{panel.示例}}
{{/if}}

## 写作前必做（硬要求）

写正文前，**必须**调用两个 skill 各至少一次：

1. `search_wiki`：查目标账号的写作惯例、典型 {{role中文}} 套路、常用衔接句
   - query 示例：`{{account}} 怎么写 {{article_type}} 类文章的 {{role中文}}`
   - **query 必须具体**——带账号名、文章类型、段落角色

2. `search_raw`：查跟本文产品 / 嘉宾 / 话题相关的原始信息
   - query 示例：`{{product_name}} 用户反馈` / `{{guest_name}} 最近言论`
   - 目的：拿到具体数字 / 原话 / 场景

查完再写。如果两个 skill 都返回空 / 无关结果，**继续写**，但在段首加注释 `<!-- no wiki/raw hits -->` 便于人工排查。

## 硬规则（绝对不允许违反）

{{hardRulesBlock}}

## 项目上下文

{{projectContextBlock}}

## 声线参考

- **人称**：we_ratio={{panel.pronoun_policy.we_ratio}}，you_ratio={{panel.pronoun_policy.you_ratio}}，避免：{{panel.pronoun_policy.avoid}}
- **调性**：{{panel.tone.primary}}，humor={{panel.tone.humor_frequency}}，opinionated={{panel.tone.opinionated}}
- **粗体**：{{panel.bold_policy.frequency}}；加粗：{{panel.bold_policy.what_to_bold}}；不加粗：{{panel.bold_policy.dont_bold}}
- **衔接句模板**（从里挑）：{{panel.transition_phrases}}
- **数据引用**：required={{panel.data_citation.required}}，格式={{panel.data_citation.format_style}}

---

现在开始写。只输出**最终段落正文**，markdown 格式，不要前言 / 解释 / 代码围栏。
```

## 接口签名

```ts
// packages/agents/src/roles/writer-bookend-agent.ts

export interface RunWriterBookendOpts {
  role: 'opening' | 'closing';
  sectionKey: string;                     // 'opening' | 'closing'
  account: string;                        // 十字路口Crossing
  articleType: '实测' | '访谈' | '评论';
  panel: PanelV2;                         // 从 resolveStyleBindingV2 拿的
  typeSection: string;                    // panel 正文里对应 type 的 section body
  hardRulesBlock: string;                 // 从 HardRulesStore.read() + renderHardRulesBlock 来的
  projectContextBlock: string;            // 从 context-bundle-service 来的
  product_name?: string;
  guest_name?: string;
  invokeAgent: AgentInvokeFn;             // 底层 LLM 调用
  dispatchTool: (call) => Promise<...>;   // tool 调度（search_wiki / search_raw）
  onEvent?: (ev: WriterToolEvent) => void;
  images?: string[];
  addDirs?: string[];
  maxRounds?: number;
}

export interface WriterRunResult {
  finalText: string;
  toolsUsed: ToolUsage[];
  rounds: number;
  meta: { cli: string; model?: string; durationMs: number; total_duration_ms: number };
}

export async function runWriterBookend(opts: RunWriterBookendOpts): Promise<WriterRunResult>;
```

```ts
// packages/agents/src/roles/writer-shared.ts

export function renderBookendPrompt(opts: {
  role: 'opening' | 'closing';
  account: string;
  articleType: '实测' | '访谈' | '评论';
  typeSection: string;
  panel: PanelV2;
  hardRulesBlock: string;
  projectContextBlock: string;
  product_name?: string;
  guest_name?: string;
}): string;

export function extractSubsection(typeSection: string, subsectionName: string): string;

export function renderHardRulesBlock(
  rules: WritingHardRules,
  panelBannedVocab: string[],
): string;  // 已存在于 writer.ts, 迁移过来
```

## 测试策略

### 单元测试

| 测试文件 | 覆盖 |
|---|---|
| `writer-shared.test.ts` | `extractSubsection` 切各种 panel section / `renderBookendPrompt` 两个 role 的 placeholder 替换 / `renderHardRulesBlock` 合并 panel + 全局词汇 |
| `writer-bookend-agent.test.ts` | mock LLM 两个响应（opening / closing）各 1 次，验证 prompt 正确渲染、role 正确传递、tool runner 接入正常 |

### 集成（不跑真 LLM）

| 测试文件 | 覆盖 |
|---|---|
| `writer-orchestrator.test.ts`（如已有）| 验证 orchestrator 的 event 流 `section_started / section_completed` 未变、agent_key 是 `writer.opening` / `writer.closing`（对外 API 兼容）|

### 手动验收

重跑 trae 项目（已重置到 evidence_ready + article_type=实测）。断言：

1. writer 产出 opening + closing + practice × 4 + transitions，无阻塞 / 失败
2. opening 字数落在 panel `word_count_ranges.opening` 内
3. closing 字数落在 panel `word_count_ranges.closing` 内
4. run artifact 里能看到 `writer.tool_called { tool: search_wiki }` 和 `{ tool: search_raw }` 至少各一次
5. 输出没有 banned_vocabulary 里的词（人工扫）
6. 输出没有"不是X而是Y"句式 / 破折号

## 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| 模板替换 bug（placeholder 没替换干净） | `renderBookendPrompt` 返回字符串后跑正则检查 `/{{[^}]+}}/`，有残留就 throw |
| LLM 不调 search_wiki / search_raw 直接写 | prompt 明确强制；tool runner 观察到 0 tool call 的边界情况加 warning 事件（不阻塞）|
| panel 里某 subsection（比如"示例"）为空 | `extractSubsection` 返回空字符串，prompt 里对应位置渲染成空，LLM 自行处理 |
| config.json 里 writer.opening / writer.closing tools 配置不一致 | 启动时 log warning，不阻塞；注释在 agent-config 文档里标明两者应保持一致 |

## 非目标

- 不动 practice / stitcher / style_critic agent
- 不加 post-write validator / 字数 retry（留 B.3）
- 不改 panel 格式
- 不改 hard rules yaml schema
- 不引入新的模板引擎依赖
- 不改 config.json 的 agent 配置结构

---

**完。**
