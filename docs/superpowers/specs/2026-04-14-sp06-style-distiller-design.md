# SP-06 Style Distiller 设计稿

**日期：** 2026-04-14
**前置：** crossing-kb 的 `ref_articles` 表已导入足够文章（生产环境已有 `~/CrossingVault/.index/refs.sqlite` ~45+ 账号/百万级文章）；SP-05 Writer 已上线并已识别内容质量问题需要更细致的风格参考
**目标：** 从 `refs.sqlite` 里某账号的历史文章中自动蒸馏出"可被 Writer agent 直接当 few-shot 使用"的结构化风格卡（`08_experts/style-panel/<account>_kb.md` v2），替代手工 v1 的 `十字路口_kb.md` 同类产物
**范围：** 4 步 pipeline（量化分析 / 结构提炼 / 片段采集 / 合成）+ CLI + 最小 UI + 可选参数（样本数 / 时间范围）
**非目标：** 多账号批量蒸馏、增量蒸馏（v2→v3）、蒸馏质量评估、自动 refresh、手工 v1 内容融合；skill 定义（暂缓，看 SP-06 跑完质量是否还需要）；**主题专家蒸馏**（`08_experts/topic-panel/experts/*.md`，SP-02 topic_expert 用，指纹是"会怎么想"而非"怎么写得像"）——留给 SP-07，可复用本期的采样/量化基础件

---

## 1. 背景

SP-05 Writer 把评测文章流程打通后，内容质量未达到预期——具体表现为写作 agent 输出的行文节奏、引用风格、金句套路都偏"通用 AI 腔"，不够贴近十字路口本身的文风。根因：`writer.opening` / `writer.practice` / `writer.closing` 用的"参考账号"只是一个手工 v1 的 `十字路口_kb.md`（2 篇样本手工蒸馏，覆盖不全），信息密度不足。

SP-06 要做的是：把 v1 手工蒸馏扩到 v2 自动蒸馏——从 refs.sqlite 里读某账号的大量文章（默认 200 篇），跑一个 4 步 pipeline 产出更丰富的风格卡。关键是**可操作+可复刻**：Writer agent 不仅要学到"总体调性"，还要拿到具体的句式模板、量化指标、真实片段锚点。

## 2. 架构 Pipeline

```
CLI:  pnpm crossing-kb distill-style <account> [flags]
      ↓
UI:   /style-panels → 选账号 → 点「蒸馏」 → DistillForm 提交
      ↓
      POST /api/kb/style-panels/<account>/distill
      ↓
orchestrator (packages/kb/src/style-distiller/orchestrator.ts)
      ↓
┌─ Step 1: Quantitative Analyzer（纯代码，无 LLM）
│   读 refs.sqlite 按 account + 时间范围过滤 → LIMIT sample_size 分层采样 → 遍历 body_plain，算：
│   字数分布 / 段长 / 加粗频次 / emoji / 图文比 / 人称比例 / 常见转折词
│   → .distill/<account>/quant.json
│
├─ Step 2: Structure Distiller（agent, default opus）
│   从采样池分层挑 5-8 篇精读（按字数桶 × 时间桶）→
│   提：定位 / 开头模板库 / 结构骨架 / 结尾模板库 / 句式库 / 语气 / 禁区
│   → .distill/<account>/structure.md
│
├─ Step 3: Snippet Harvester（agent, default opus，分批）
│   采样池分批（每批 20-30 篇）→ per-batch 扫候选片段（tag：开头钩子/加粗金句/结尾/引用/过渡）→
│   跨批聚合去重，每 tag 保留 3-10 条（按出现位置/长度评分）
│   → .distill/<account>/snippets.yaml
│
└─ Step 4: Composer（agent, default opus）
    读 quant + structure + snippets → 生成完整 kb.md v2
    → 08_experts/style-panel/<account>_kb.md（直接覆盖旧文件，不备份）
```

**设计选择记录：**
- 多步拆分而非单 agent 一次跑完（方案 B）—— 每步职责单一、cheap/expensive 模型可混用、中间产物可 debug、避免 200 篇爆 context
- 直接覆盖 kb.md（方案 A）—— v1 的"待补/声明"等历史注释由用户手动合并；不搞自动 merge 规避脆弱融合
- CLI + UI 都做 —— CLI 适合运维/脚本，UI 适合临时蒸馏新账号

## 3. 文件布局

```
~/CrossingVault/
├─ .index/refs.sqlite                              ← 输入源（已存在）
├─ 08_experts/style-panel/
│  ├─ 十字路口Crossing_kb.md                       ← 最终 v2 产物（覆盖原手工 v1）
│  ├─ 赛博禅心_kb.md
│  └─ ...
└─ .distill/                                       ← 中间产物
   ├─ 十字路口Crossing/
   │  ├─ quant.json                                ← Step 1 输出
   │  ├─ structure.md                              ← Step 2 输出
   │  ├─ snippets.yaml                             ← Step 3 输出
   │  └─ distilled_at.txt                          ← timestamp + CLI 参数记录
   └─ ...
```

中间产物保留，以便：
- 单独重跑某一步调试（`--only-step snippets`）
- 用户核对各步输出是否合理后再合成（`--only-step composer`）

下次蒸馏同账号整个 `.distill/<account>/` 目录被覆盖。

## 4. kb.md v2 格式

### 4.1 Frontmatter

```yaml
---
type: style_expert
account: 赛博禅心
version: v2
distilled_from: 87 篇样本（从 2025-01-01~2026-04-01 范围的 314 篇中采样）
sample_size_requested: 100
sample_size_actual: 87
article_date_range: 2025-01-01 ~ 2026-04-01
distilled_at: 2026-04-14T15:30:00Z
distilled_by:
  structure: claude/opus
  snippets: claude/opus
  composer: claude/opus
sample_articles_read_in_full:
  - 2025-08-15_XXX
  - 2025-11-20_YYY
  - 2026-03-10_ZZZ
---
```

### 4.2 正文结构（4 层维度）

**第一层 · 结构（v1 已有 10 节）**
- 一、核心定位
- 二、开头写法
- 三、结构骨架
- 四、实测段落写法
- 五、语气 tone
- 六、行业观察段 / 收束段
- 七、视觉/排版元素
- 八、禁区
- 九、给 Writer Agent 的一句话 system prompt 提炼
- 十、待补（v2 蒸馏时填）

**第二层 · 句式模板库**（v2 新增）
- 开头钩子变体（5-8 种，每种带模式 + 1-2 条原文例）
- 结尾模板变体（4-5 种）
- 转折/过渡词库（频次 top-10）
- 加粗金句模式（"不是 X，而是 Y" 等）
- 引用模板（"据 <机构> 统计" / "<产品人> 在 <平台> 发过" / 行业共识陈述）
- 标题模板（全部出现过的变体 + 频次）

**第三层 · 量化指标表**（v2 新增，Step 1 直接输出）

| 指标 | 中位数 | 区间 (P10-P90) | 说明 |
|---|---|---|---|
| 整篇字数 | 3200 | 1800-5500 | Writer 出稿时参考 |
| 开头段字数 | 420 | 280-650 | — |
| 每个 case 小节字数 | 380 | 220-550 | — |
| 结尾段字数 | 280 | 180-380 | — |
| 段平均长度（句数） | 2.4 | 1.2-3.8 | — |
| 加粗句频次 | 每小节 0.7 | 0-2 | — |
| emoji 密度 | 🚥 每篇 1.8 次 | — | — |
| 图文比 | 每 180 字 1 张 | 80-300 | — |
| "我们" / "你" / 无人称 | 48% / 12% / 40% | — | — |

Writer agent 使用说明（在此节末尾）：出稿后可以自检偏离度，严重偏离就重写。

**第四层 · 片段库**（v2 新增，Step 3 输出）

按 tag 分组，每组 3-10 条。格式：

```yaml
开头钩子·数据派:
  - from: 2026-04-08_AI-漫剧爆了
    excerpt: "2026 年春节档，一个数据很震撼：据 Monnfox 统计，AI 漫剧播放量突破了 25 亿次。"
  - from: 2025-11-12_XXX
    excerpt: "..."
  - ...

加粗金句·判断式:
  - from: 2026-03-19_LibTV
    excerpt: "**C1 这次还有一个比较明显的点，不只是术法效果，打斗动作的连贯性也做得更稳。**"
  - ...

结尾·留白式:
  - from: 2026-04-08_AI漫剧
    excerpt: "AI 漫剧的竞赛，可能刚刚进入下半场。"
  - ...

引用·同行号:
  - ...

过渡·case 间:
  - ...
```

Writer agent 可按 tag 检索对应片段做 few-shot：写开头时塞 "开头钩子" 3-5 条，写结尾时塞 "结尾" 全部候选。

## 5. ConfigStore 扩展

复用 SP-03.5 `agents.*`。新增 3 个 key，默认 opus：

```json
{
  "agents": {
    "style_distiller.structure": { "cli": "claude", "model": "opus" },
    "style_distiller.snippets":  { "cli": "claude", "model": "opus" },
    "style_distiller.composer":  { "cli": "claude", "model": "opus" }
  }
}
```

Step 1 量化分析器是纯代码，不进 ConfigStore。

**运行时 override：**
- CLI: `--structure-model <m>` / `--snippets-model <m>` / `--composer-model <m>` / `--structure-cli codex` 等
- UI DistillForm: 每步一行下拉，默认来自 ConfigStore，当次可覆盖

## 6. CLI 命令

```bash
# 列 refs.sqlite 里所有账号 + 文章数 + 日期范围
pnpm crossing-kb list-accounts

# 蒸馏某账号（所有参数默认）
pnpm crossing-kb distill-style "赛博禅心"

# 指定样本数 + 时间范围
pnpm crossing-kb distill-style "赛博禅心" \
  --sample-size 100 \
  --since 2025-01-01 \
  --until 2026-04-01

# 覆盖模型
pnpm crossing-kb distill-style "赛博禅心" \
  --structure-model opus \
  --snippets-model haiku \
  --composer-model opus

# 只跑某一步（复用已有中间产物）
pnpm crossing-kb distill-style "赛博禅心" --only-step snippets
pnpm crossing-kb distill-style "赛博禅心" --only-step composer

# dry-run：只跑 Step 1 量化，不写最终 md
pnpm crossing-kb distill-style "赛博禅心" --dry-run
```

**CLI stdout 流式进度：**
```
[1/4] quant-analyzer
  → 314 articles in date range, 100 sampled
  → .distill/赛博禅心/quant.json written
[2/4] structure-distiller (claude/opus)
  → 7 articles picked for deep read
  → running...
  → .distill/赛博禅心/structure.md written (3.2 KB, 12.3s)
[3/4] snippet-harvester (claude/opus)
  → 4 batches planned
  → batch 1/4: running... done (142 candidates)
  → batch 2/4: ...
  → aggregating 580 raw → 147 deduped → 67 ranked
  → .distill/赛博禅心/snippets.yaml written
[4/4] composer (claude/opus)
  → running...
  → 08_experts/style-panel/赛博禅心_kb.md written (8.4 KB, 24.1s)
Total: 52s
```

## 7. 后端 API

| Method | Path | 语义 |
|---|---|---|
| GET | `/api/kb/accounts` | 列 refs.sqlite 所有账号。响应：`[{ account, count, earliest_published_at, latest_published_at }]` |
| GET | `/api/kb/style-panels` | 已蒸馏面板列表（SP-05 已有，不改） |
| POST | `/api/kb/style-panels/:account/distill` | body: `{ sample_size?, since?, until?, cli_model_per_step?, only_step? }`；派发 orchestrator；SSE 流式推进度 |

### 7.1 SSE events

- `distill.step_started` `{step, account, cli, model}`
- `distill.step_completed` `{step, duration_ms, stats}`
- `distill.batch_progress` `{step: "snippets", batch, total_batches, candidates_so_far}`
- `distill.step_failed` `{step, error}`
- `distill.all_completed` `{account, kb_path, sample_size_actual}`

SSE 走独立 channel（不挂 `useProjectStream`——那是 per-project 的，蒸馏是全局运维动作）。前端在 DistillForm 所在页面直接订阅此端点的 SSE 响应。

### 7.2 请求参数校验

- `sample_size`：整数，最小 20，最大该账号总文章数。超出返 400
- `since` / `until`：可选 ISO 日期；`since > until` 返 400；范围内文章数 < 20 返 400（样本太少不值得蒸馏）
- `account`：不存在 refs.sqlite 返 404
- `only_step`：值域 `"quant" | "structure" | "snippets" | "composer"`，其他返 400

## 8. 代码布局

```
packages/agents/src/
├─ roles/
│  ├─ style-distiller-structure-agent.ts
│  ├─ style-distiller-snippets-agent.ts
│  └─ style-distiller-composer-agent.ts
├─ prompts/
│  ├─ style-distiller-structure.md
│  ├─ style-distiller-snippets.md
│  └─ style-distiller-composer.md

packages/kb/src/
├─ cli.ts                               ← 加 list-accounts / distill-style 子命令
├─ style-distiller/
│  ├─ quant-analyzer.ts                 ← Step 1，纯代码
│  ├─ sample-picker.ts                  ← 分层采样（字数桶 × 时间桶）+ "精读 5-8 篇" 挑选
│  ├─ snippet-aggregator.ts             ← 跨批聚合 + 去重 + 排序
│  ├─ orchestrator.ts                   ← 串起 4 步，支持 only-step、dry-run、SSE 回调
│  └─ types.ts                          ← QuantResult / SnippetCandidate / etc.
└─ index.ts                             ← 导出 orchestrator + cli 辅助

packages/web-server/src/
├─ routes/kb-style-panels.ts            ← 已有 GET 列表；加 POST /:account/distill
└─ routes/kb-accounts.ts                ← 新，GET /api/kb/accounts

packages/web-ui/src/
├─ pages/StylePanelsPage.tsx            ← 新独立页（或改造 SettingsDrawer 加块）
├─ components/style-panels/
│  ├─ StylePanelList.tsx                ← 已蒸馏列表
│  ├─ AccountCandidateList.tsx          ← refs.sqlite 账号
│  └─ DistillForm.tsx                   ← sample_size / date range / 3 段 agent cli/model
└─ api/style-panels-client.ts           ← getAccounts / startDistill SSE
```

## 9. 前端 UI

**顶栏加路由入口 `/style-panels`**（在 ProjectList 的 header 加一个链接"风格面板"）。

### 9.1 `StylePanelsPage.tsx` 布局

```
┌─ 已蒸馏的面板 ──────────────────────────────────┐
│ 十字路口Crossing  v2  2026-04-10  [重新蒸馏]     │
│ 赛博禅心         v1  2026-04-13  [升级到 v2]     │
│                                                  │
├─ 待蒸馏（refs.sqlite 里还没蒸馏） ───────────────┤
│ 量子位           1982 篇  2024-09 ~ 2026-04  [蒸馏] │
│ 新智元           1628 篇  2023-11 ~ 2026-04  [蒸馏] │
│ ...                                              │
└──────────────────────────────────────────────────┘
```

### 9.2 `DistillForm.tsx`

```
┌ 蒸馏 赛博禅心 ─────────────────────────────────┐
│                                                │
│  文章来源: refs.sqlite · 1229 篇                │
│  sample_size:      [200]    (min 20, max 1229)  │
│  时间范围:          [2023-11-01] ~ [2026-04-14] │
│                     文章总数 1229（选中范围内）  │
│                                                │
│ ─ agent 配置 ────────────────────────────────── │
│ structure: [claude ▾] [opus ▾]                 │
│ snippets:  [claude ▾] [opus ▾]                 │
│ composer:  [claude ▾] [opus ▾]                 │
│                                                │
│ [开始蒸馏] [取消]                              │
└────────────────────────────────────────────────┘
```

提交后表单变 ProgressView，底部流式显示 CLI-style log：

```
[1/4] quant-analyzer
  → 314 articles in range, 87 sampled
  → .distill/赛博禅心/quant.json written
[2/4] structure-distiller (claude/opus)
  → running...
  ...
```

跑完 toast "蒸馏完成 · <path>"，页面自动回到 StylePanelsPage 并把该账号移入"已蒸馏"列表。

## 10. 错误处理

- **Step 任一失败**：`distill.step_failed` + orchestrator abort；已写入的中间产物保留，可 `--only-step` 重跑失败步
- **文章数不足 20**（时间范围过窄）：400 + 前端提示
- **refs.sqlite 缺失 account**：404
- **蒸馏运行中用户断连 SSE**：orchestrator 继续跑，用户刷新页面会重新订阅 SSE（后端需要把状态挂内存 map，超出本期——MVP 里用户断连就断连，刷新后重新发起）
- **磁盘写失败**：step_failed，不污染最终 kb.md

## 11. 测试策略

约 25-30 tests。保持 SP-01~SP-05 的 314 全部不回归。

| 模块 | 用例 |
|---|---|
| `quant-analyzer.ts` | 字数/段长/加粗/emoji/图文比/人称 正确性（3 篇 fixture 文章） |
| `sample-picker.ts` | 分层采样（字数桶 × 时间桶分布均匀）/ 精读 5-8 篇挑选 |
| `snippet-aggregator.ts` | 按 text hash 去重 / 按 tag 限 3-10 条 / 排序（按 position + length） |
| 3 个 agent | mock invokeAgent，验证 prompt 含样本、输出正确解析（structure → .md / snippets → yaml） |
| `orchestrator.ts` | 4 步串联 / step 失败 abort / `--only-step snippets` 只跑第 3 / `--dry-run` 只 Step 1 / 中间产物写入 `.distill/` |
| CLI | `list-accounts` 输出格式 / `distill-style` 参数透传 / flag 校验 |
| `GET /api/kb/accounts` | 返回 refs.sqlite 账号 + count + date range |
| `POST /:account/distill` | SSE 流 / 400 sample_size 超限 / 400 since>until / 400 范围内文章<20 / 404 账号不存在 |
| UI 组件 | StylePanelList 渲染两段 / DistillForm 提交带完整 body / SSE 日志实时追加 |
| e2e | mock 3 agent → 真跑 orchestrator pipeline → 验证 kb.md 格式 + 中间产物存在 + frontmatter 完整 |

## 12. 估算

2-3 天 / 14-18 个 TDD task：

| M | tasks | 内容 |
|---|---|---|
| M1 代码侧基础 | 3 | quant-analyzer / sample-picker / snippet-aggregator |
| M2 3 个 agent + prompts | 3 | structure / snippets / composer |
| M3 orchestrator | 2 | 主流程（4 步 + only-step + dry-run + SSE 回调） / error path |
| M4 CLI | 2 | list-accounts / distill-style + flag 解析 + stdout 进度 |
| M5 后端路由 | 2 | GET /api/kb/accounts / POST distill SSE |
| M6 前端 | 3 | style-panels-client + StylePanelsPage + DistillForm |
| M7 e2e + smoke | 1 | mock agent e2e + 人工跑 1 个账号验证 |

## 13. Future Work（明确不做）

- **多账号批量蒸馏** —— CLI shell 循环即可（`for a in ...; do distill-style $a; done`），不做 built-in
- **增量蒸馏** —— v2→v3 只跑新增文章；看 SP-06 跑完 v2 质量后再定
- **蒸馏质量评估** —— v1 vs v2 diff、覆盖率打分
- **自动 refresh** —— 定时蒸馏 / 新文章触发
- **v1 内容融合** —— 自动合并手工 v1 的"待补/声明"节进 v2；用户自己 diff 改
- **skill 定义**（SP-06B，暂缓）—— 看 SP-06 跑完 Writer 输出质量是否仍不够、再决定要不要加 agent skill 层
- **主题专家蒸馏**（SP-07）—— 把同一套 4 步 pipeline 改造成"思维指纹"蒸馏，输出到 `08_experts/topic-panel/experts/`，给 SP-02 topic_expert 用。采样器 / 量化器 / orchestrator 框架可复用；Step 2-4 换不同 prompt 和输出格式
- **断连重连** —— 蒸馏中途断 SSE 继续订阅；MVP 不做
- **蒸馏资源限流** —— 同时最多跑 N 个蒸馏；MVP 单实例顺序跑

---

## 14. 交付物

1. 本 spec 提交 git
2. 实施计划 `docs/superpowers/plans/2026-04-14-sp06-style-distiller.md`
3. 14-18 个 TDD task
4. 完成后人工 smoke：挑一个账号（比如"赛博禅心"）跑 CLI 蒸馏 + UI 蒸馏各一次，检查：
   - `.distill/<account>/` 四个中间产物都在
   - `08_experts/style-panel/<account>_kb.md` v2 格式齐全（4 层维度）
   - Writer agent 换用 v2 kb 后产出质量是否改善（主观判断）
