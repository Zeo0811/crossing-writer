# 风格蒸馏重做（SP-A）设计文档

**创建日期**: 2026-04-16
**作者**: zeoooo + Claude
**状态**: 设计已确认，待实施

## 背景

当前风格蒸馏产出的 panel 质量不足以指导 writer 写出"像目标账号"的文章。诊断出两大根因：

1. **账号内文章类型混杂** — "十字路口Crossing" 同账号包含实测、访谈、评论三种结构完全不同的内容，当前 pipeline 把所有文章同等看待蒸馏成一个 panel，writer 拿到的是"平均值"风格，每种类型都写得不像。
2. **字符偏移切片不稳** — 当前 section slicer 让 LLM 输出字符 offset `[{start_char, end_char, role}]`，LLM 对字符计数敏感度差，50 篇样本只切出 41 个 opening（遗漏率 18%），长文章误差累加。

本次重做目标：让蒸馏产物从"风格的描述性综述"变成 writer **可执行的写作蓝图**。

**不在本 spec 范围**：Writer 阶段重构（分 SP-B）、配置 UI 重构（分 SP-C）。本 spec 只改 `packages/kb/src/style-distiller/*`、panel 文件格式、新加"写作硬规则" Tab、改 StylePanelsPage 的迁移/进度 UI。Writer 侧只有最小变动（读新 panel 格式、应用硬规则）。

## 架构总览

### 蒸馏时数据流（离线 batch）

```
account (e.g., 十字路口Crossing)
    │
    ↓  [1] Sampling · 按时间分层从 sqlite 抽 N 篇 (N 用户自选)
    ↓
    ↓  [2] Per-article Labeling · 每篇一次 opus 调用
    ↓      输入: 预切好的段落列表 P1..Pn
    ↓      输出: { article_type: 实测|访谈|评论,
    ↓              paragraphs: { P1: opening|practice|closing|other } }
    ↓
    ↓  [3] Aggregation · 按 (role × type) 汇集段落 snippets
    ↓      3 role × 3 type = 9 个 bucket + 每 bucket 的 quant 统计
    ↓
    ↓  [4] Composition · 每 role 一次 opus 调用（共 3 次并行）
    ↓      输入: 该 role 下 3 个 type 的全部 snippets + quant
    ↓      输出: 一个 panel 文件（v2 格式 z：frontmatter + 3 个 type section）
    ↓
磁盘产物:
  08_experts/style-panel/{account}/
    opening-v2.md
    practice-v2.md
    closing-v2.md
```

### 写作时数据流（在线）

```
brief 阶段: 用户下拉手选 article_type (实测|访谈|评论)
       → 存 project.json#article_type (必填)
       ↓
writer 启动:
  1. 读 ~/CrossingVault/08_experts/writing-hard-rules.yaml (全局硬规则)
  2. 读 panel 文件 (opening-v2.md / practice-v2.md / closing-v2.md)
     - YAML 解析 frontmatter
     - 按 ## 切正文 section
     - 只取 article_type 对应的那一 section
  3. 拼 writer prompt:
     [硬规则] + [panel frontmatter 约束] + [当前 type section] + [brief]
```

## 数据模型

### Article Type（全局硬编码）

```ts
type ArticleType = '实测' | '访谈' | '评论'
```

三种类型全局固定，不做 per-account 自定义。

### Panel 文件 Schema（v2）

以 `opening-v2.md` 为例，`practice-v2.md` / `closing-v2.md` 结构同构：

```markdown
---
# 基础元信息
account: 十字路口Crossing
role: opening          # opening | practice | closing
version: 2
status: active         # active | deleted
created_at: 2026-04-16T20:00:00Z
source_article_count: 50
slicer_run_id: rdall-xxx

# Types 清单 & 分布
types:
  - key: 实测
    sample_count: 30
  - key: 访谈
    sample_count: 15
  - key: 评论
    sample_count: 5

# 字数硬约束
word_count_ranges:
  opening: [150, 260]       # 本 role 字数范围
  article: [3500, 8000]     # 全文字数参考

# 人称策略
pronoun_policy:
  we_ratio: 0.42            # 每千字"我们"次数
  you_ratio: 0.31
  avoid: [笔者, 本人]

# 语气温度（离散枚举）
tone:
  primary: 客观克制          # 档位: 客观克制 | 热血推荐 | 冷峻分析 | 调侃戏谑 | 教学温和 | 专家严肃
  humor_frequency: low      # low | mid | high
  opinionated: mid          # low | mid | high

# 粗体策略
bold_policy:
  frequency: "每段 0–2 处"
  what_to_bold: [核心观点句, 产品关键卖点, 数据结论]
  dont_bold: [整段, 人名, 产品名]

# 过渡句模板
transition_phrases:
  - "先说 XXX"
  - "这里补充一点："
  - "重点来了："
  - "听起来有点抽象，我们用..."

# 数据引用要求
data_citation:
  required: yes
  format_style: "数字+单位+来源"
  min_per_article: 1

# 小标题节奏
heading_cadence:
  levels_used: [h2, h3]
  paragraphs_per_h3: [5, 10]
  h3_style: "疑问句 / 动名词短语"

# 账号特有禁用词（LLM 蒸馏时挖掘）
# 注意：panel 这里用扁平字符串数组，与 writing-hard-rules.yaml 的 {word, reason} 对象数组不同
# Merge 时 panel 字符串会被包成 {word: 笔者}（无 reason）
banned_vocabulary:
  - 笔者
  - 本人
  - 鉴于
---

# 十字路口Crossing · opening 风格卡 v2

## 开头 · 实测模式

### 目标
给读者一个「为什么值得花 5 分钟读这篇」的钩子。

### 字数范围
150 – 260 字

### 结构骨架（三选一）
**A. 场景/历史锚点** · 一句年份+具体事件 → 引申到今天的产品
**B. 数据 hook** · 一个数字+来源+对比 → "这个数字意味着..."
**C. 趋势观察+设问** · 最近观察到... → 为什么/怎么办？

### 高频锚词（用不是抄）
- "2013 年 / 1997 年" — 具体年份开头
- "最近有一个趋势特别明显" — 趋势起手式
- "一手实测" — 产品锚定词

### 禁止出现（本账号从来不写）
- "本文将介绍..." / "接下来让我们来看..."
- 泛泛的产品定位描述

### 示例（3 条真实样本，节奏模板）

**示例 1** · ColaOS 篇 · 结构 A
> 2013 年，Spike Jonze 拍了一部电影叫《Her》。主角爱上了他电脑里的操作系统。12 年后的今天，ColaOS 开了一个内测⋯

**示例 2** · PixVerse C1 篇 · 结构 B
> 2026 年春节档，一个数据很震撼：据 Monnfox 统计，AI 漫剧播放量突破了 25 亿次⋯

**示例 3** · Flowith 篇 · 结构 C
> 最近有一个趋势特别明显：越来越多的产品开始做 CLI⋯

## 开头 · 访谈模式

（同构，6 个子小节）

## 开头 · 评论模式

（同构，6 个子小节）
```

**Schema 约束**：

- frontmatter 是严格 YAML，有对应 TS interface `PanelFrontmatterV2`
- 正文 heading 约定：`## 开头 · <type>模式` / `## 主体 · <type>模式` / `## 结尾 · <type>模式`
- 每个 type section 下必须有 6 个 `### ` 子小节（目标/字数/骨架/锚词/禁止/示例）
- 示例区用 blockquote `>` 包裹

### 全局写作硬规则

路径：`~/CrossingVault/08_experts/writing-hard-rules.yaml`

```yaml
version: 1
updated_at: 2026-04-16T20:00:00Z

banned_phrases:
  - pattern: "不是.+?而是"
    is_regex: true
    reason: "烂大街句式"
    example: "这不是一个工具，而是一个伙伴"
  - pattern: "[—–]"
    is_regex: true
    reason: "禁止破折号"

banned_vocabulary:
  - word: 笔者
    reason: "第三人称自称不自然"
  - word: 鉴于
    reason: "公文腔"

layout_rules:
  - "段落平均字数 ≤ 80"
  - "段与段之间必须有空行"
```

**设计约束**：

- 全局硬规则**跨账号、跨类型**应用
- 和 panel 里的 `banned_vocabulary` **合并**后塞进 writer prompt
- 写作时每次都重新读文件，yaml 改动**立即生效**（不缓存）

## Pipeline 步骤细节

### [1] Sampling

- 模块：`packages/kb/src/style-distiller/sample-picker.ts`（复用现有）
- 输入：`account`, `sample_size`（用户自选，UI number input），`since/until`（可选）
- 实现：按 `published_at` 分层采样
- 输出：`ArticleSample[]`
- 无 LLM 调用

### [2] Per-article Labeling（新步骤，替代旧 section-slicer）

- 新模块：`packages/kb/src/style-distiller/article-labeler.ts`
- 新辅助模块：`packages/kb/src/style-distiller/paragraph-splitter.ts`

**段落预切器 `paragraph-splitter.ts`**（纯启发式）：

- 输入：文章 `body_plain` 字符串
- 规则：
  1. 按 `\n\n`（空行）切段
  2. `##/###/####` 标题单独成段
  3. 图片行（`![alt](url)`）单独成段，压缩成 `[图]` 标记
- 输出：`string[]`（P1..Pn 顺序）

**LLM 打标器 `article-labeler.ts`**：

- 输入：一篇 `ArticleSample`
- prompt：opus，单次调用，合并两件事
  ```
  你是公众号文章结构分析器。给定"十字路口"账号的一篇文章（已预切为段落 P1..Pn），请：

  1. 判断文章类型（严格三选一：实测 / 访谈 / 评论）
  2. 为每段打角色标签：opening | practice | closing | other

  角色定义: ...（详细描述）

  输出（严格 YAML，不要代码围栏）：
  article_type: <type>
  paragraphs:
    P1: <role>
    P2: <role>
    ...
  ```
- 输出：`LabeledArticle = { id, type, paragraphRoles: Map<string, Role> }`
- 并发：**10**（`p-limit(10)`），避免 API throttle

### [3] Aggregation

- 模块：`packages/kb/src/style-distiller/snippet-aggregator.ts`（改造现有）
- 纯 JS，无 LLM
- 分组：按 `(role, type)` → 9 个 bucket
- 每 bucket 产出：
  ```ts
  interface Bucket {
    role: 'opening' | 'practice' | 'closing'
    type: '实测' | '访谈' | '评论'
    snippets: Array<{ article_id, title, excerpt }>
    sample_count: number
    quant: {
      word_count_median, word_count_p10, word_count_p90,
      bold_density_per_100_chars,
      we_ratio, you_ratio,
      heading_cadence_avg,
      ...
    }
  }
  ```
- 额外计算：整账号的 `banned_vocabulary` 候选（词频 log 分析：样本里**从不出现**的常见文言/公文词）

### [4] Composition

- 模块：`packages/kb/src/style-distiller/composer.ts`（改造现有）
- LLM：opus，**每 role 一次**（3 次并行）
- prompt：
  ```
  你是风格卡 v2 生成器。给定一个账号、一个 role（opening/practice/closing），以及该 role 下三个 type（实测/访谈/评论）的所有样本 snippets 和定量统计，生成一个 panel 文件。

  严格按 v2 schema 输出：
  - frontmatter（YAML）：所有元信息 + 6 个策略字段 + banned_vocabulary
  - 正文：每个 type 一个 `## <role> · <type>模式` section，内部 6 个 `### ` 子小节

  [此处塞入详细 schema 模板、示例格式约束]
  ```
- 输出：一个完整的 markdown 字符串，写入 `{account}/{role}-v2.md`

## 进度持久化

### 路径

`~/CrossingVault/08_experts/style-panel/_runs/<run_id>.jsonl`

每行一条 JSON：

```jsonl
{"ts":"...", "type":"distill.started","account":"十字路口Crossing","sample_size":50}
{"ts":"...", "type":"sampling.done","actual_count":50}
{"ts":"...", "type":"labeling.article_done","id":"abc","type":"实测","progress":"1/50"}
{"ts":"...", "type":"labeling.article_done","id":"def","type":"访谈","progress":"2/50"}
...
{"ts":"...", "type":"labeling.all_done"}
{"ts":"...", "type":"aggregation.done","buckets_count":9}
{"ts":"...", "type":"composer.started","role":"opening"}
{"ts":"...", "type":"composer.done","role":"opening","panel_path":"...opening-v2.md"}
{"ts":"...", "type":"composer.started","role":"practice"}
{"ts":"...", "type":"composer.done","role":"practice","panel_path":"..."}
{"ts":"...", "type":"composer.started","role":"closing"}
{"ts":"...", "type":"composer.done","role":"closing","panel_path":"..."}
{"ts":"...", "type":"distill.finished","files":[...]}
```

粒度：里程碑 + 每篇文章完成 + 每 composer 完成，约 60 条/run，磁盘 ~20KB/run。

### API 变更

- `GET /api/config/style-panels/runs?status=active` → 返回当前活跃 run 列表
- `GET /api/config/style-panels/runs/<run_id>/stream` → SSE 流
  - 先回放 `_runs/<run_id>.jsonl` 全部历史
  - 再继续订阅该 run 的实时事件
- 蒸馏接口 `POST /api/config/style-panels/distill-all` 返回 `{ run_id }` 供前端保存

### UI 行为

- StylePanelsPage 进入时调用 `GET /runs?status=active`
- 如果有活跃 run：该 account 行显示 ⚡ 动画点，点击直接打开 ProgressView（不是 DistillForm）
- ProgressView 重连 SSE，先回放历史再继续流
- 用户可自由退出/回来，进度不丢

### 崩溃恢复

**不做**自动续跑。崩溃后 run 状态标 `failed`，用户手动重蒸馏。

## 写作时消费

### `article_type` 来源

- Brief 阶段用户下拉**必填**（枚举 3 选 1）
- 存 `project.json#article_type`
- Brief analyst **不**做自动推断（用户手选）

### Writer orchestrator 改动

路径：`packages/web-server/src/services/writer-orchestrator.ts`

```ts
async function runWriter(opts: RunWriterOpts) {
  const project = await store.get(opts.projectId)
  const articleType = project.article_type
  if (!articleType) {
    throw new MissingArticleTypeError('请回 Brief 阶段选择文章类型')
  }

  // 对每个 writer agent (opening / practice / closing)
  for (const agentKey of writerAgents) {
    const panel = await resolveStyleBinding(binding, store)
    if (panel.version < 2) {
      throw new StyleVersionTooOldError('请重新蒸馏到 v2')
    }
    if (!panel.types.some(t => t.key === articleType)) {
      throw new TypeNotInPanelError(`当前面板没有「${articleType}」类型`)
    }
    const section = extractTypeSection(panel.body, articleType)
    // ... 拼 prompt
  }
}
```

### 新加辅助模块

- `packages/web-server/src/services/panel-parser-v2.ts` — YAML frontmatter + type section extractor
- `packages/web-server/src/services/hard-rules-loader.ts` — yaml 加载 + 合并全局/账号禁用清单
- `packages/web-server/src/services/writer-prompt-builder.ts`（可能已有）— 最终 prompt 拼装

## UI 变更

### 1. Brief 阶段

- `BriefIntakeForm` 加 `article_type` 下拉（必填），3 个枚举值 + emoji

### 2. StylePanelsPage

- 顶部加 "🧹 清理旧面板" 按钮，一次性删除所有 v1/legacy 文件（带确认 modal）
- "已蒸馏"列表只显示 v2+ panel
- 活跃蒸馏 run 识别：账号行⚡动画，点击进 ProgressView

### 3. 新 Tab："写作硬规则"

- 左侧导航新增入口
- 三个 block：禁用句式 / 禁用词汇 / 排版规则
- 每个 block 表格式展示 + "新增"/"编辑"/"删除" 按钮
- 编辑走**模态框**（不是 inline）
- 保存调 `PUT /api/config/writing-hard-rules`

### 4. Writer 阻塞 UI

- `MissingArticleTypeError` → 项目 workbench 顶部红条 "请回 Brief 阶段选择文章类型"，带"返回 Brief"按钮
- `StyleVersionTooOldError` → 红条 "此账号的风格面板是旧版本，请去风格库重新蒸馏"
- `TypeNotInPanelError` → 红条 "当前风格面板缺少「实测」类型样本，请切换类型或重新蒸馏该账号"

## API 变更汇总

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config/style-panels/runs?status=active` | 新：活跃蒸馏 run 列表 |
| GET | `/api/config/style-panels/runs/<run_id>/stream` | 新：run SSE |
| DELETE | `/api/config/style-panels/cleanup?filter=v1_and_legacy` | 新：清理旧 panel |
| GET | `/api/config/writing-hard-rules` | 新：读硬规则 yaml |
| PUT | `/api/config/writing-hard-rules` | 新：写硬规则 yaml（原子替换整个对象）|
| POST | `/api/projects/:id/writer/start` | 改：增加 v2 panel 校验、article_type 校验 |

## 测试策略

### 1. 单元测试

| 模块 | 用例数 | 测试点 |
|---|---|---|
| `paragraph-splitter.ts` | 15 | `\n\n` 切段 / `##` 标题 / 图片独立 / 混合 |
| `panel-parser-v2.ts` | 10 | YAML round-trip / type section 提取 / 缺失字段降级 |
| `hard-rules-loader.ts` | 5 | 加载 yaml / 合并全局+账号清单 |
| `composer-prompt-builder.ts` | 4 | 输入 snippets/quant → 输出 prompt 结构正确 |
| `article-labeler.ts` | 3 | mock LLM 返回 → 解析 YAML 正确 |

### 2. 集成测试

- Fixture：5 篇真实文章（实测/访谈/评论各覆盖），放 `packages/kb/tests/fixtures/style-distill-v2/`
- 跑完整 pipeline（LLM 调用 mock 返回固定 YAML）
- 断言：
  - 3 个 panel 文件生成
  - 每个 panel frontmatter `types[]` 长度 = 3
  - 每个 type section 正文包含 6 个 `### ` 子小节
  - `word_count_ranges.opening[0] < opening[1]`

### 3. 人工评审（用户负责）

上线后用户跑真实账号蒸馏，读 v2 panel 验证：

- 三个 type 的"结构骨架"**真的不一样**（不是 LLM 写了 3 遍类似内容）
- 示例段落**对应 type**（不串味）
- 6 个策略字段有合理值

**工具支持（我负责）**：

- `scripts/evaluate-panel.ts` — 读 panel 输出 markdown 可视化报告
- `scripts/diff-writer-output.ts` — 同 brief 跑 v1 和 v2 panel，输出 diff

## 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| 段落预切器对某些文章切不好 | 上线后按坏样本加 regex 规则；paragraph-splitter 的单元测试持续扩展 |
| LLM 分类 article_type 不准 | 固定 3 类已经很窄，prompt 给出清晰定义 + 50 篇实验验证；错分可靠用户手选 override |
| Composer 输出不符合 schema | prompt 里给严格 schema + 少量 few-shot；输出解析失败时降级到字符串 fallback + 报警 |
| 老 panel 清理误删 | 清理按钮带二次确认 modal 列出待删文件；用户确认后**硬删**（和 Section "UI 变更 · StylePanelsPage" 里约定一致，不做 soft delete，文件系统够简单不引入额外状态） |
| 全局硬规则和账号 banned 冲突 | 合并逻辑：全局优先，账号追加；去重 |

## 依赖 / 前置

- `@crossing/agents` 要暴露一个 `invokeClaudeRaw(prompt, model)` 接口给 labeler/composer 使用（如果还没有）
- `p-limit` npm 包（并发控制）
- 现有的 `style-panel-store.ts` 要扩展支持 `version` 字段和 `types[]` 解析

## 明确非目标

- **不改 writer 生成逻辑**（写什么、怎么写）—— 那是 SP-B
- **不改配置 UI 的整体流程感**（只加一个 Tab）—— 那是 SP-C
- **不改 brief analyst 的核心行为**（只加 1 个字段收集）
- **不做 article_type 的 LLM 辅助推断**

---

**完。**
