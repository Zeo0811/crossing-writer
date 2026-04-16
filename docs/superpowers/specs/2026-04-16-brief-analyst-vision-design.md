# Brief Analyst 视觉读图 + 维度重构 Design

Date: 2026-04-16
Owner: zeoooo
Status: draft

## 背景

用户上传带图的 brief 时，Brief Analyst 的输出里出现「由于 brief 以图片形式提供且 OCR 工具在本次会话中不可用，confidence 分数为 0.52」之类的自白。排查发现：

- Claude CLI 的 `@path` 语法在 `--tools ""` 全关的前提下，图片根本没触发 Read，模型看到的只是一串文件路径字符串，不是像素。
- 图片 tab 的 `imageFiles` state 在 submit 时没有任何落盘路径，点"提交"会报"请选择文件"。
- `brief-analyst.md` prompt 没明确告诉模型"你具备视觉能力、不要声明 OCR 不可用"。
- 维度定义有些缺口（缺赛道坐标、缺可实测 demo 线索、style_reference 单薄、gap_notes 不可用于生成待办）。
- Crossing 风格的三条硬规则（禁"不是 X 而是 Y"、禁 `-`/`--`、必须短段落+空行）没有被烧进任何 prompt。

## 目标

一次性修齐四件事：

1. **图片真正作为 vision 输入** —— 不走 OCR、不走中间转写，Claude / Codex 两条 CLI 都让模型亲眼读图。
2. **三个上传 tab 归一** —— 文字、文件（图片文件）、图片 tab 最终都产出一份 `brief.md`，里面的 `![](images/xxx.png)` 被服务端捕获并以 vision 方式回传给 agent。
3. **Brief Analyst 维度重构** —— 砍读者、去 tone.forbidden_words、加赛道/demo/参考文章/结构化 gap，卖点按优先级排。
4. **Crossing 风格红线系统化** —— 三条硬规则烧进 writer 系列 agent 的 prompt，不作为 brief 字段抽取。

## 非目标

- 不新增 vision→text 的中间转写服务
- 不切换到 `@anthropic-ai/sdk` 直连（保持 CLI 路线）
- 不调整发布渠道约束
- 不改动 brief-analyzer-service.ts 的 pipeline 拓扑（正则抓图路径 → images[] 的流程保留）

## 改动点一览

### 改动 A：Adapter 开 Read tool（核心技术修复）

**文件：** `packages/agents/src/model-adapter.ts`

Claude 分支当前：
```ts
const args = ["-p", "-", "--tools", "", ...addDirArgs, ...];
```

改为：
```ts
const args = [
  "-p", "-",
  "--tools", images.length > 0 ? "Read" : "",
  ...addDirArgs,
  ...
];
```

这样 prompt 里的 `@/abs/brief/images/xxx.png` 才能真正被 Read 工具拉取成 vision content block 进模型。无图时保持 `--tools ""` 不变。

Codex 分支已经用 `--image=${p}` 走原生 vision，不动。

### 改动 B：UI 三个 tab 归一到 `uploadBriefText`

**文件：** `packages/web-ui/src/components/right/BriefIntakeForm.tsx`

当前 `submit()`：
- `mode === "text"` → `uploadBriefText({text})` ✅
- `mode === "file"` / `mode === "image"` → 走 `uploadBriefFile` 逐个上传，**但图片 tab 的 `imageFiles` 根本没被使用**，报错"请选择文件"

改造：

```
mode === "text":
  既有逻辑，text 字段已经是 markdown，包含 ![](images/xxx.png)
  → uploadBriefText({ text })

mode === "image":
  把 imageFiles 里的每一项拼成 "![](images/xxx.png)\n\n"
  → uploadBriefText({ text: combined })

mode === "file":
  两类区分：
    - 图片文件（image/*）：先 uploadBriefAttachment 落到 brief/images/ 得到 url，
      再合成 "![](images/xxx.png)" 追加到 text 里，最后 uploadBriefText
    - docx/pdf/md/txt：保持 uploadBriefFile 原路径
```

**推荐简化：** 文件 tab 如果只接受 docx/pdf/md/txt（`accept=".docx,.pdf,.md,.txt"` 已这样限制），图片文件本就去不了文件 tab。那文件 tab 保持原样即可，不用额外处理。真正要改的是图片 tab。

最终只需要改图片 tab 的 submit 分支。

### 改动 C：Brief Analyst prompt 重构

**文件：** `packages/agents/src/prompts/brief-analyst.md`

#### C1. 开头加视觉指令（砍 OCR 幻觉）

在 "# 硬性要求" 之前加一段：

```
# 输入形态说明

brief 可能是纯文字、纯图片、或图文混合。无论哪种形态：
- 你具备完整的视觉能力，直接读取 brief 正文里引用的每一张图片内容
- 抽取图中的文字、图表数据、排版调性、视觉意图
- 禁止声明"OCR 不可用 / 需要外部工具 / 无法解析图片"
- 不因 brief 是图片而降低 confidence
```

#### C2. 改 frontmatter 字段

移除：
- `audience` 整组（primary / secondary / persona_keywords）
- `tone.forbidden_words`

新增：
- `competitors: []` —— brief 中提及的对标/竞品
- `category_positioning: <str>` —— 产品在赛道里的坐标描述
- `demo_hooks: []` —— 可上手实测的功能点 / 体验场景（供 Case Maker 使用）
- `reference_articles: [{ url, why_referenced }]` —— 风格对标文章链接 + 为什么参考
- `reference_tone_keywords: []` —— 对标调性关键词

修改：
- `key_messages` / `value_props` —— prompt 明确要求"按甲方最在意的顺序排"
- `gap_notes` —— 从 `[str]` 改为 `[{ field, missing, suggest_ask }]`
- 保留 `style_reference` 字段但标记 deprecated，或直接用 reference_articles + reference_tone_keywords 替代（推荐直接替换）

#### C3. 最终字段清单

```yaml
---
type: brief_summary
project_id: {{project_id}}
generated_by: brief_analyst
generated_at: {{now}}
model_used: {{model_used}}

# 产品身份
client: <str|null>
brand: <str|null>
product: <str|null>
product_category: <str>
product_stage: <prelaunch|launched|iteration|end-of-life|null>

# 传播目的
goal: <str>
goal_kind: <awareness|conversion|retention|thought_leadership>

# 赛道坐标
competitors: ["..."]
category_positioning: <str>

# 内容约束（按甲方优先级从高到低排）
key_messages:
  - "..."
value_props:
  - "..."
demo_hooks:
  - "..."
must_cover_points:
  - "..."
forbidden_claims:
  - "..."
avoid_angles:
  - "..."

# 调性
tone:
  voice: <str>
  preferred_words: ["..."]
reference_articles:
  - url: <str>
    why_referenced: <str>
reference_tone_keywords: ["..."]

# 交付
required_deliverables:
  - format: <str>
    word_count_range: [min, max]
    with_images: <bool>
deadline: <YYYY-MM-DD|null>
deadline_strictness: <soft|hard>

# 元信息
gap_notes:
  - field: <str>
    missing: <str>
    suggest_ask: <str>
confidence: <0-1>
---
```

### 改动 D：Crossing 风格红线烧进 writer prompt

**文件（已确认三个都存在）：**
- `packages/agents/src/prompts/writer-opening.md`
- `packages/agents/src/prompts/writer-practice.md`
- `packages/agents/src/prompts/writer-closing.md`

在每个文件靠前的位置加一段固定 section（可考虑抽成 include 或直接 copy-paste）：

```
# 十字路口风格红线（硬约束，违反即重写）

1. 禁用「不是 X，而是 Y」句式 —— 这类 AI 味的对比转折不要
2. 禁用 `-` / `--` 作为解释破折号 —— 用正常标点和短句代替
3. 必须使用"短段落 + 段落空行"排版 —— 这是十字路口的招牌节奏：
   - 一个段落尽量 1-3 句
   - 段落之间必须留空行
   - 不要把多个论点糊在一段里
```

**决策：** 先在每个 writer prompt 里各自 copy 一份（simple），不抽公共文件。等发现 prompt 数量增加或需要统一修改时再抽。

## 数据流（改造后）

```
用户上传（文字 / 图片 tab）
  ↓
UI 统一生成 markdown 文本，含 ![](images/xxx.png)
  ↓
POST /api/projects/:id/brief/text
  ↓
brief.md 落盘到 projectDir/brief/brief.md
图片存到 projectDir/brief/images/*
  ↓
analyzeBrief 触发
  ↓
brief-analyzer-service.ts 正则抓所有 ![](...)，resolve 绝对路径，传 images[]
  ↓
BriefAnalyst.analyze({ briefBody, images, addDirs })
  ↓
model-adapter.invokeAgent:
  - claude: --tools "Read", prompt 末尾拼 @/abs/path
  - codex: --image=/abs/path
  ↓
模型作为 vision 真正"看到"图片内容
  ↓
输出带新维度结构的 brief-summary.md
```

## 风险 / 边界

- **Read 工具不是零代价**：开了 Read 后模型理论上还能 Read 其他文件。但 `--add-dir` 已限定只能访问 brief 目录；同时 agent 本身 prompt 聚焦在"读图片、输出 YAML"，不会乱跑。观察一轮没问题就接受。
- **图片数量上限**：没设。单次 brief 超过 20 张图片时的 token 代价较大，先观察用户实际使用。如果出现问题再在 service 层加硬上限（如 15 张）。
- **旧项目回滚**：已有 brief-summary.md 按旧 schema 生成（有 audience、forbidden_words、单 string gap_notes）。不做 migration，后续消费方（topic-expert、case-maker）保持对旧字段容错。brief-summary 是"生成后主要供 agent 读取"的中间产物，回放即可。
- **style_reference 字段**：grep 确认活代码只有 `brief-analyst.md` 本身引用，其他只在旧 spec/plan 文档里出现（无活消费方）。直接删，不做兼容层。

## 验收

1. 一张带图片的 brief（纯图 / 图文混合）跑 brief-analyst，输出里不再出现"OCR 不可用"字样，confidence 基于真实内容而非因图片被惩罚。
2. 图片 tab 上传后点"提交并解析"能正常触发 analysis（不再报"请选择文件"）。
3. 输出 brief-summary.md 的 frontmatter 严格匹配新 schema：
   - 没有 `audience` 块
   - 没有 `tone.forbidden_words`
   - 有 `competitors` / `category_positioning` / `demo_hooks` / `reference_articles` / `reference_tone_keywords`
   - `gap_notes` 为 `[{field, missing, suggest_ask}]`
4. 写作 agent 产出的文章：
   - 不出现「不是 X，而是 Y」句式
   - 不出现 `-` / `--` 作为破折号
   - 段落结构清晰、段间有空行
