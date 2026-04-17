# SP-B.3 · Post-Write Validator + 自动 Retry

## 背景

B.2 让字数 / 禁用句式 / 禁用词作为 prompt 约束和自查清单进入 bookend agent，实测有效（opening 320 chars ∈ [200,400]），但 closing 仍 13% 超 max（395 / 350）。LLM 偶尔会忽略 prompt 里的约束，prompt 层拦不住的事需要一个代码层 validator + 单次 retry 兜底。

## 目标

Writer 写完 opening / closing 之后，用代码（非 LLM）扫一遍，命中违规则把违规清单塞回 agent 重写一次。仅 1 次 retry，再次违规也放过，只在事件日志里警告。

## 范围

**在：**

- 新增 `bookend-validator`：纯函数，输入 `(finalText, role, hardRules, wordOverride)`，输出 `{ ok, violations }`
- Orchestrator 的 opening / closing 调用点包一层 `runWithValidation`：首轮 → validator → 违规则 retry 1 次 → 写入结果
- Bookend agent 的 retry 路径：在 userMessage 头部注入上一次产出 + 违规清单 + 「按这个修，其余保留」
- 三个新事件：`writer.validation_passed` / `writer.validation_retry` / `writer.validation_failed`
- 测试：validator 单元测试 + orchestrator 带 mock 的集成测试

**不在：**

- Practice / transitions / style_critic 的 validator（practice 字数差异大，transitions 太短，style_critic 本来就是全文 critic 角色）
- 多轮 retry（只 1 次，防止 token 爆炸 + 无限回环）
- UI 开关 / 配置 validator 本身（hard rules 已有配置页就够了）
- LLM self-critic（B.2 的自查清单已经是 prompt 层自查，B.3 走代码层）
- Banned phrase / 禁用词的容忍度（零容忍，命中就 retry）

## 决策

### 字数 tolerance：20%

Hard rules 里的 word_count_overrides 是 `[min, max]`。Validator 把它放宽到 `[floor(min*0.8), ceil(max*1.2)]` 才算违规。closing `[200, 350]` → 实际触发区间 `(160, 420)`。

- **Why**：用户明确说「超出 20% 都可以接受」。LLM 写到精确字数代价大，容忍度换稳定性划得来。
- **How to apply**：只字数一项吃 tolerance，其余零容忍。

### 禁用句式 / 禁用词：零容忍

命中一条就算违规。

- **Why**：「不是X而是Y」这种烂大街句式本来就是红线，放 10% 容忍率相当于白给。
- **How to apply**：validator 扫描命中即立刻 retry，不管出现几次。

### Retry 策略：最多 1 次

- 第一次 bookend 产出 → validator
- 违规 → retry（注入反馈）
- 第二次产出 → 无论合规与否都写入结果
- 第二次仍违规 → 发 `writer.validation_failed` 事件（section_completed 事件也照常发，不中断流水线）

**Why**：重写 1 次成本可接受（对 opening/closing 只是加 1 次 LLM call）。多轮 retry 容易把段落改坏且 token 吃紧。用户说「不用那么细」的延伸解读是流水线不能因为 validator 而脆弱。

### Validator 用字符数（不含空格 / 换行 / markdown 标记）

`countChars(text)`：剥掉 markdown（`**`、`#`、列表前缀、code fence）+ 剥掉空白字符，数剩下的 `[\u4e00-\u9fff]` 和英文字符。

- **Why**：panel 里的字数范围指的是正文字符数，markdown 标记不算。B.2 spec 里没写清楚这点，B.3 落实。
- **How to apply**：validator 和 UI 提示保持一致。

## 架构

```
orchestrator.ts
  ├── runBookendWithValidation(role='opening')   ← 新增包装函数
  │     ├── 第 1 次：runWriterBookend()          ← 原本就有
  │     ├── bookend-validator(text, role, rules)
  │     └── 若违规 → runWriterBookend(previousAttempt={...})
  └── runBookendWithValidation(role='closing')

packages/agents/src/roles/
  ├── writer-bookend-agent.ts                    ← 改动：新增 previousAttempt?: RetryFeedback 参数
  ├── writer-shared.ts                           ← 改动：renderBookendPrompt 支持 retry 反馈头
  └── bookend-validator.ts                       ← 新文件
         ├── countChars(text): number
         ├── findBannedPhrases(text, rules): BannedHit[]
         ├── findBannedVocabulary(text, rules): VocabHit[]
         ├── checkWordCount(text, role, rules, override): WordHit | null
         └── validateBookend(opts): ValidationResult
```

## 组件细节

### bookend-validator.ts

```ts
export type Violation =
  | { kind: 'word_count'; chars: number; min: number; max: number; tolerance: 0.2 }
  | { kind: 'banned_phrase'; pattern: string; reason: string; excerpt: string }
  | { kind: 'banned_vocabulary'; word: string; reason: string };

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
  chars: number;
}

export function validateBookend(opts: {
  finalText: string;
  role: 'opening' | 'closing';
  hardRules: WritingHardRules;
  wordOverride?: [number, number];
}): ValidationResult;
```

**字数检查**：
- min/max 来源：override > hardRules.word_count_overrides[role] > panel `### 字数范围` 解析 > 硬默认
- 实际触发区间 `[floor(min*0.8), ceil(max*1.2)]`
- `chars = countChars(finalText)`

**禁用句式**：每条 `pattern`，若 `is_regex`，`new RegExp(pattern).test(text)`；否则 `text.includes(pattern)`。返回所有命中。

**禁用词**：每条 `word`，`text.includes(word)`。返回所有命中。

**零匹配 = ok**；任意一个有命中 = 不 ok。

### Retry 反馈注入

`renderBookendPrompt` 新增参数 `retryFeedback?: RetryFeedback`：

```ts
interface RetryFeedback {
  previousText: string;
  violations: Violation[];
}
```

当 `retryFeedback` 非空时，在 prompt 头部加一段：

```markdown
## 上一次产出 - 不合规，需要重写

上一次你产出的正文（供参考，不是让你微调）：

<previousText>

违规清单（按这些修，其他不变）：

1. [word_count] 全文 395 字，超过 [200, 350] tolerance 20% 上限（420）。减到 350 以下。
2. [banned_phrase] 命中"不是.+?而是"：「不是工具而是伙伴」。换一种写法。
3. [banned_vocabulary] 命中"笔者"。去掉。

修完再自查清单扫一遍。只输出最终正文。
```

### Orchestrator 改动

新增辅助函数 `runBookendWithValidation`（在 writer-orchestrator.ts 内）：

```ts
async function runBookendWithValidation(params: {
  role: 'opening' | 'closing';
  publishEvent: (type: string, data) => Promise<void>;
  runBookend: (retryFeedback?: RetryFeedback) => Promise<WriterRunResult>;
  hardRules: WritingHardRules | null;
  wordOverride?: [number, number];
  sectionKey: string;
}): Promise<WriterRunResult> {
  const first = await params.runBookend();
  if (!params.hardRules) return first;

  const val1 = validateBookend({
    finalText: first.finalText, role: params.role,
    hardRules: params.hardRules, wordOverride: params.wordOverride,
  });

  if (val1.ok) {
    await params.publishEvent('writer.validation_passed', {
      section_key: params.sectionKey, attempt: 1, chars: val1.chars,
    });
    return first;
  }

  await params.publishEvent('writer.validation_retry', {
    section_key: params.sectionKey, violations: val1.violations,
  });

  const second = await params.runBookend({
    previousText: first.finalText,
    violations: val1.violations,
  });

  const val2 = validateBookend({
    finalText: second.finalText,
    role: params.role,
    hardRules: params.hardRules,
    wordOverride: params.wordOverride,
  });

  if (val2.ok) {
    await params.publishEvent('writer.validation_passed', {
      section_key: params.sectionKey, attempt: 2, chars: val2.chars,
    });
  } else {
    await params.publishEvent('writer.validation_failed', {
      section_key: params.sectionKey, violations: val2.violations,
    });
  }

  return second;
}
```

Orchestrator 的两个 bookend 调用点改成调 `runBookendWithValidation`，内部闭包捕获 runWriterBookend 的其余参数。

## 数据流

```
[user triggers writer]
     ↓
orchestrator.runWriter
     ↓
├─ opening: runBookendWithValidation('opening')
│   ├─ runWriterBookend(retry=null) → text₁
│   ├─ validateBookend(text₁) → ok? (若 ok, 发 validation_passed, 写入)
│   ├─ else: publishEvent('writer.validation_retry', violations)
│   ├─ runWriterBookend(retry={previousText: text₁, violations})
│   ├─ validateBookend(text₂) → publishEvent(passed | failed)
│   └─ writeSection(text₂)  # 不管 val2 结果
├─ practice.* (无变动)
├─ transitions (无变动)
└─ closing: 同 opening
```

## 错误处理

- **Validator 自己抛错**（regex 非法等）：log + 跳过 validation（视为 ok），不阻塞流水线
- **Retry 的 LLM call 失败**：走原本的 `writer.section_failed`，section 标记失败
- **Validator 检测不到**（panel 里没 word_count，override 也没设）：跳过字数检查，其他检查照常
- **Banned phrases 规则集空**：跳过该项检查

**核心原则**：validator 是最佳努力兜底，不能因为它自己的 bug 把整个写作流程搞挂。

## 测试

### 单元 — `packages/agents/tests/bookend-validator.test.ts`

- `countChars` 剥 markdown + 空白
- `validateBookend` 字数：min 下限 / max 上限 / tolerance 内放过 / tolerance 外违规
- `validateBookend` 禁用句式：regex 命中 / 字面量命中 / 不命中
- `validateBookend` 禁用词：命中 / 不命中
- `validateBookend` 多种违规叠加：都应该出现在 violations 里
- `validateBookend` 边界：空 hardRules / override 覆盖 panel / 只有 panel 没 override

### 集成 — `packages/web-server/tests/writer-orchestrator-validation.test.ts`

Mock invokeAgent：
- Case 1：首轮 return 合规文本 → validation_passed 发 1 次，runWriterBookend 调 1 次
- Case 2：首轮 return 字数超 25% → validation_retry 发 1 次，runWriterBookend 调 2 次（第二次 userMessage 含 "上一次产出 - 不合规"），第二次合规 → validation_passed attempt=2
- Case 3：两轮都违规 → validation_failed 发 1 次，section_completed 照常写入第二次产出

## 风险

| 风险 | 缓解 |
|---|---|
| Retry 把段落改坏（LLM 过度修改无关处） | Prompt 里明确「按清单修，其余不变」。只 1 次 retry 降低概率 |
| 字数 count 算法和 UI 显示不一致 | validator 和 UI 共用 `countChars` 帮助函数（UI 端可复用；短期可只在 server 用） |
| Banned phrase regex 在 panel 或 hardRules 里写错 | try/catch 包住正则编译，失败当作「不命中」，log 一下 |
| Opus 第二轮还超 | 第 2 次不再 retry，section 照常落盘，只发 failed 事件 —— 数据还能用 |

## 非目标

- Practice / transitions / style_critic 的 validator（未来看需求再说）
- Banned phrase / 禁用词的容忍度
- 多轮 retry / 智能 retry 策略
- Validator 在 UI 的手动触发 / 查看
- 字数统计在 frontend 的实时显示

## 验收标准

### 代码验收

- `pnpm --filter @crossing/agents test bookend-validator` 全绿
- `pnpm --filter @crossing/web-server test writer-orchestrator-validation` 全绿
- Lint / typecheck 无新错

### 实测验收（trae project）

构造一个 bookend prompt 故意不给自查清单（或者直接 mock agent），让 closing 产出一次命中「不是X而是Y」的文本：

- Event 序列：section_started → validation_retry（含违规清单）→ section_completed → validation_passed 或 validation_failed
- 最终落盘的 closing 不含「不是X而是Y」（若第二次合规）
- runLogDir 下有两个 writer.closing 子目录（第一次 + 第二次 retry）

正常 run（agent 合规）：

- Event 序列：section_started → validation_passed attempt=1 → section_completed
- 只有一个 writer.closing runLogDir

## Non-Scope 回归

完成后，B.3 遗留给 B.4+ 的事：

- Practice / transitions 的 validator
- Style critic 和 validator 的协同（现在 validator 在 critic 之前，不冲突但也未打通）
- UI 上展示 validation violations
- 字数 tolerance 的项目级 override
