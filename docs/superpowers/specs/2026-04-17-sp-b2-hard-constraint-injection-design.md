# SP-B.2: Writer 硬约束强化 + 字数 override + Writer 运行归档 设计文档

**创建日期**: 2026-04-17
**作者**: zeoooo + Claude
**状态**: 设计已确认，待实施
**前置**: SP-A + SP-B.1（`feat/sp-a-style-distill-v2` 分支）

## 背景

B.1 合并 opening + closing 成 bookend agent，并已经做了基本的硬规则注入（global banned phrases / vocabulary / layout + panel banned_vocabulary）。但实测发现约束仍有漏洞：

1. **字数超**：Trae 项目 opening 写了 364 字（panel 范围 "13 – 117 字(单段)"），closing 第一次写 3632 字（因为 panel 没有 closing 字数字段，fallback 到 article 范围 3500-8000）。
2. **字数推算歧义**：panel 写的"单段"字数容易被 LLM 理解成"整段也就这么多"——实际"整段"是多个单段串起来的。
3. **Panel 数据不一定可靠**：distill labeler 的角色切分偶尔偏窄，反推出的字数范围过严；另一方面账号风格漂移时，panel 更新滞后。用户需要**显式硬编码字数范围**绕过 panel 不确定性。
4. **Prompt 里硬规则放在头部，写作时 LLM 注意力衰减**，写完自己不回头检查。
5. **Writer 不归档 prompt/response**——想排查"为什么 LLM 没听话"没有现场。

## 范围

**在：**

- 在 `writing-hard-rules.yaml` 加 `word_count_overrides` 字段，per-role 字数范围，优先级高于 panel。
- `renderBookendPrompt` 的字数处理改造：解析 panel `### 字数范围`、应用 override、拆分成"单段 + 总体"双约束渲染进 prompt。
- `writer-bookend.md` prompt 尾部加"交付前自查清单"meta-instruction block。
- UI 的硬规则页加 `word_count_overrides` 编辑 block。
- Writer 调用 runLogDir，把 prompt/response 归档到项目 runs 目录。

**不在：**

- Post-write 代码级 validator / auto-retry（B.3 单独做）
- Practice / stitcher / style_critic 的 prompt 改动（只碰 bookend 和 orchestrator 对 bookend 的调用）
- Panel schema 改动（字数仍从 panel `### 字数范围` 读 + override 覆盖）
- Article-level merge 逻辑
- 禁用词扫描代码（B.3 做）

## 决策

### D1. 硬编码字数默认值

`HardRulesStore` seed default 增加：

```yaml
word_count_overrides:
  opening: [200, 400]     # 总字数
  closing: [200, 350]     # 总字数
  article: [3500, 8000]   # 整篇文章
```

依据：十字路口实测类文章 opening 平均 300-350 字、closing 250-300 字，各给 ±50 缓冲。

### D2. 默认段数（当 panel 只给单段字数 + 无 override 时）

- `opening`: 5 段
- `closing`: 7 段

用于：`perParaMax × paragraphCount = totalMaxFallback`。不是硬约束，仅提示 prompt "整段大概不超 X 字"。

### D3. 自查清单 meta-instruction 放 prompt 尾部

放在 "现在开始写" 的指令**之前**——LLM 的 recency effect 让靠近末尾的指令更易被遵守。

### D4. UI 编辑 UX

`word_count_overrides` 用 **2 个 number input**（min / max）表示区间，不用 text 避免解析歧义。为每个 role 一行。

### D5. Writer runLogDir 归档

- Bookend agent 调用时增加 `runLogDir: <projectDir>/runs/<ts>-writer.<role>` 路径
- 每次调用产出 `prompt.txt` / `response.txt` / `meta.json` / `trace.ndjson`
- 改动只在 `writer-orchestrator.ts` 调用 runWriterBookend 的两处（opening + closing），不动 model-adapter（已经支持 runLogDir）。
- Practice / stitcher / style_critic 暂不加（避免 scope 膨胀，后续可补）。

## 架构改动

### 数据流：word count 解析 + 应用

```
writingHardRules.word_count_overrides[role]    (from yaml)
    ↓ if defined, use directly
            ↓
      [totalMin, totalMax]
            ↓
     render prompt
    
如果 override 未定义:
    panel.subs.字数范围 "10 – 110 字(单段)"
        ↓ parseWordCountRange
    { min: 10, max: 110, perPara: true }
        ↓ multiply by defaultParaCount[role]
    totalRange = [10*5=50, 110*5=550]
        ↓
     render prompt with both per-para and total
```

### 共享 types

`writer-shared.ts` 的 `WritingHardRules` 扩充。Hard-rules-store 的 `WritingHardRules` 同步扩充。两处手动对齐（agents 包不依赖 web-server）。

## 文件改动

### 修改

```
packages/agents/src/roles/writer-shared.ts
  - 扩 WritingHardRules interface：新增 word_count_overrides?
  - 新 parseWordCountRange(text): { min, max, perPara } | null
  - 新 resolveWordConstraint(role, subsText, override): { perParaText, totalText, totalMax }
  - renderBookendPrompt:
      - RenderBookendPromptOpts 新增 wordOverride?: [min, max]
      - 内部调 resolveWordConstraint，替换两个新 placeholder

packages/agents/src/prompts/writer-bookend.md
  - 把 `{{panel.word_count}}` 改为双行:
      单段: {{panel.word_count_per_para}}
      总体: {{panel.word_count_total}}
  - 在 `现在开始写` 之前插入"交付前自查清单" 6 条

packages/web-server/src/services/hard-rules-store.ts
  - 扩 WritingHardRules 同 agents 侧
  - DEFAULT_RULES 增加 word_count_overrides seed

packages/web-server/src/services/writer-orchestrator.ts
  - runWriterBookend 调用处（opening + closing 两处）
    - 传入 wordOverride 从 hardRulesStore.read() 取
    - 新增 runLogDir 参数（<projectDir>/runs/<ts>-writer.<role>）
  - 传 hardRulesStore 到 renderBookendPrompt 的调用链

packages/agents/src/roles/writer-bookend-agent.ts
  - RunWriterBookendOpts 新增 wordOverride?: [min, max]
  - 新增 runLogDir?: string — 透传给 invokeAgent

packages/agents/src/model-adapter.ts
  - 已经支持 runLogDir，无需改动（只验证 writer 调用时传进去）

packages/web-ui/src/pages/WritingHardRulesPage.tsx
  - 新增第 4 个 RulesSection，标题"字数范围(覆盖面板)"
  - 3 行固定: opening / closing / article
  - 每行 2 个 number input (min / max)
  - 空值 = 该 role 不 override

packages/web-ui/src/components/writing-hard-rules/RuleEditModal.tsx
  - 增加 'word_count' kind 分支
  - 渲染 2 个 number input 替代 text

packages/web-ui/src/api/writing-hard-rules-client.ts
  - WritingHardRules 类型扩充
```

### 新增

```
packages/agents/tests/writer-shared.test.ts   (已有文件，扩 tests)
  - parseWordCountRange: 6 个 case
  - resolveWordConstraint: 4 个 case
  - renderBookendPrompt: 新增 2 个 case（override 生效 / panel perPara 推算）
```

## 类型 & 签名

```ts
// writer-shared.ts

export interface WritingHardRules {
  version: 1;
  updated_at: string;
  banned_phrases: Array<{ pattern: string; is_regex: boolean; reason: string; example?: string }>;
  banned_vocabulary: Array<{ word: string; reason: string }>;
  layout_rules: string[];
  word_count_overrides?: {
    opening?: [number, number];
    closing?: [number, number];
    article?: [number, number];
  };
}

/** Parse strings like "10 – 110 字(单段)" / "150-260 字" / "200 字以内". */
export function parseWordCountRange(text: string): { min: number; max: number; perPara: boolean } | null;

export interface WordConstraint {
  perParaText: string;    // "每段 10 – 110 字" or "—"
  totalText: string;      // "200 – 400 字" or "50 – 550 字（单段×默认段数推算）"
  totalMax: number;       // 400 — used in self-review checklist template
}
export function resolveWordConstraint(
  role: 'opening' | 'closing',
  panelSubsText: string,
  override?: [number, number],
): WordConstraint;

export interface RenderBookendPromptOpts {
  // ... 既有字段
  wordOverride?: [number, number];
}
```

```ts
// writer-bookend-agent.ts

export interface RunWriterBookendOpts {
  // ... 既有字段
  wordOverride?: [number, number];
  runLogDir?: string;
}
```

## 自查清单 prompt 内容（最终版）

```markdown
## 交付前自查清单（违反任一项立即重写，不要输出违规版）

1. **总字数** ≤ {{panel.word_count_total_max}} 字；单段字数满足 {{panel.word_count_per_para}}
2. **禁用句式**：扫描全文，不得命中"硬规则"block 里列出的任何一条句式
3. **禁用词汇**：扫描全文，不得命中"硬规则"block 里列出的任何一条词汇
4. **段落节奏**：每段 ≤ 80 字，段与段之间必须空行
5. **粗体**：产品名 / 人名首次出现必须加粗；整段不加粗；遵循 panel.bold_policy
6. **衔接句**：若使用衔接句，优先从 panel.transition_phrases 里挑，不自造

若任一项不通过，**在内部修订后再自查**，直到全部通过才输出。

**不要输出自查过程**，只输出最终段落正文。
```

## 测试矩阵

### `parseWordCountRange` 单测

| 输入 | 期望 |
|---|---|
| `"10 – 110 字(单段)"` | `{ min:10, max:110, perPara:true }` |
| `"150-260 字"` | `{ min:150, max:260, perPara:false }` |
| `"200 字以内"` | `{ min:0, max:200, perPara:false }` |
| `"150 – 260 字"` (全角空格 + 全角破折号) | `{ min:150, max:260, perPara:false }` |
| `"纯粹的文字"` | `null` |
| `""` | `null` |

### `resolveWordConstraint` 单测

| role | subs字数范围 | override | 期望 |
|---|---|---|---|
| opening | `"150-260 字"` | undefined | totalText 含 150-260，perParaText 空 |
| opening | `"10 – 110 字(单段)"` | undefined | totalText 含 50-550（10*5-110*5），perParaText 含 10-110 |
| opening | `"10 – 110 字(单段)"` | `[200, 400]` | totalText 200-400，perParaText 含 10-110 |
| closing | `""` | `[200, 350]` | totalText 200-350，perParaText "—" |

### `renderBookendPrompt` 新测

- 传 wordOverride 时，prompt 含 override 数值（不含 panel 原文）
- 不传 wordOverride 时，prompt 含 panel 原文 + 推算结果
- 新增自查清单段出现在正确位置（"现在开始写" 之前）

### 端到端 Trae 验收

1. Opening 字数 ∈ [200, 400]
2. Closing 字数 ∈ [200, 350]
3. Run artifacts 落盘（`/Users/zeoooo/CrossingVault/07_projects/trae/runs/*/writer.*/prompt.txt` 存在）
4. Prompt 内容包含自查清单
5. 无禁用句式 / 词汇
6. 每段 ≤ 80 字

## 非目标

- Post-write validator（B.3）
- 违规自动 retry（B.3）
- 禁用词的代码级扫描（B.3）
- Panel 的 word_count_ranges schema 扩充（继续用现有 opening/article）
- UI 字数 override 的版本记录 / 历史
- Practice agent / stitcher / style_critic 的 prompt 改动

## 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| Override 全 0/空时 UI 判断出错 | 空 inputs → undefined → panel fallback；写测试覆盖 |
| parseWordCountRange 漏 case | 先列 6 典型，遇到 null 就走 numeric fallback，不抛异常 |
| runLogDir 磁盘膨胀 | 每次 writer 约 1-2 MB（prompt ~10KB + response ~2KB + trace ~800KB）；项目级归档，用户可删 |
| 自查清单让 LLM 更啰嗦 | 加"不要输出自查过程"收束；实测验证 |
| opus 仍忽略约束 | B.2 是 prompt 层，保留 B.3 post-validator 做兜底 |
