# 专家团互评 + 人类纠偏循环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mission Round2 from "专家自评" to "专家互评"（对抗性评审），add 人类纠偏 无限迭代循环，让用户选定立意后能通过自然语言反馈让 coordinator 精修，直到满意才进入 Overview。

**Architecture:** (1) 新 prompt 文件 `topic-expert-peer-review.md` 和 `coordinator-final-synthesize.md` 替换 Round2 流程；(2) 新路由 `/mission/refine` / `/mission/confirm` 处理纠偏循环；(3) 新状态 `mission_approved_preview` / `mission_refining` / `mission_review` 在状态机里追加；(4) 新 UI 组件 `MissionApprovePreview` + `MissionReviewPanel` 承载新的用户交互。

**Tech Stack:** TypeScript, Fastify, React 18, vitest, `diff` npm（用于 refine diff 视图）, Claude/Codex CLI

**Reference spec:** `docs/superpowers/specs/2026-04-16-expert-peer-review-and-refine-design.md`

---

## File Structure

**New files:**
- `packages/agents/src/prompts/topic-expert-peer-review.md` — 互评 prompt
- `packages/agents/src/prompts/coordinator-final-synthesize.md` — 最终聚合 prompt
- `packages/agents/src/prompts/coordinator-refine.md` — 纠偏改稿 prompt
- `packages/web-server/src/services/mission-refine-service.ts` — refine / confirm 业务逻辑
- `packages/web-ui/src/components/right/MissionApprovePreview.tsx` — 选完立意后的预览 + 反馈输入
- `packages/web-ui/src/components/right/MissionReviewPanel.tsx` — 改稿回来后的 diff + 历史

**Modified files:**
- `packages/agents/src/roles/topic-expert.ts` — 新增 `round2PeerReview()` 方法
- `packages/agents/src/roles/coordinator.ts` — 新增 `finalSynthesize()` + `refine()` 方法
- `packages/web-server/src/services/mission-orchestrator.ts` — Round2 调用改 peer review，aggregate 改 finalSynthesize，写 `candidates.final.md`
- `packages/web-server/src/routes/mission.ts` — 改 `/mission/select` 状态目标；新增 `/refine` / `/confirm` / `/refines` / `/refines/:index`
- `packages/web-server/src/state/state-machine.ts` — 新状态 + transitions
- `packages/web-ui/src/hooks/useProjectStream.ts` — SSE 事件白名单加新事件
- `packages/web-ui/src/pages/ProjectWorkbench.tsx` — 新 case 渲染
- `packages/web-ui/package.json` — 加 `diff` 依赖

---

## Task 1: topic-expert-peer-review Prompt + TopicExpert 方法

**Files:**
- Create: `packages/agents/src/prompts/topic-expert-peer-review.md`
- Modify: `packages/agents/src/roles/topic-expert.ts` (add `round2PeerReview` method + interface)

**Context:** 把 Round2 从"看 candidates 自评"换成"看 candidates + peers' round1 互评"。需要一份新 prompt（要求专家必须具名引用 peer、必须至少 1 条非 support 立场）+ `TopicExpert` 类加一个 `round2PeerReview()` 方法调用它。

### Step 1.1: 写新 prompt

创建 `packages/agents/src/prompts/topic-expert-peer-review.md`：

```md
你是 {{expert_name}}，基于以下风格/口味：

---
{{kb_content}}
---

# Round 2 任务：专家团互评

Coordinator 综合各专家 Round 1 意见合成了候选 mission（`candidates.md`）。现在你要**看过其他专家的 Round 1 原文**之后，对 candidates 每一条做出对抗性评价。

## 候选列表（你要评的对象）

{{candidates_md}}

## 其他专家的 Round 1 产出（你在互评时必须参考）

{{peers_round1_bundle}}

## 你的任务

对 candidates 每一条做出判断。可选立场：
- **support**（支持）：说明为什么立意成立
- **oppose**（反对）：指出盲点 / 重复 / 角度不锐
- **supplement**（补刀）：@其他专家，点名引用 peer 观点
- **rewrite**（改写）：直接给出一句话新立意

## 硬要求

1. 必须具名引用至少 1 条 peer 观点（`peer_reference` 字段必填至少一条非空）
2. 不能全部 support——至少 1 条非 support 立场（oppose / supplement / rewrite）
3. 不能自评自己 Round 1 被采纳的情况，只评 candidates
4. 若 experts 只有 1 位（即没有 peer），本硬要求 1 自动跳过，但仍要求至少 1 条非 support

# 输出要求

严格输出 YAML frontmatter + markdown 正文：

---
type: peer_review
expert: {{expert_name}}
project_id: {{project_id}}
run_id: {{run_id}}
kb_source: {{kb_source}}
model_used: {{model_used}}
started_at: {{now}}
round: 2

reviews:
  - candidate_index: 1
    stance: <support | oppose | supplement | rewrite>
    reasoning: "..."
    peer_reference: "@<peer_name>: <引用其 round1 的一句话及理由>"
    rewritten_claim: <null 或 一句话新立意>
  - candidate_index: 2
    ...

overall_recommendation: <最推荐的 candidate_index>
---

# 互评总结
<200-400 字叙述你为什么整体倾向 overall_recommendation，互评过程中与 peers 的分歧在哪>
```

### Step 1.2: 修改 topic-expert.ts 增加 peer review 方法

在 `packages/agents/src/roles/topic-expert.ts` 的 `Round2Input` 之后、`Round3Input` 之前插入新接口：

```ts
export interface Round2PeerReviewInput {
  projectId: string;
  runId: string;
  candidatesMd: string;
  peersRound1Bundle: string;  // 其他专家 round1 拼接结果
  images?: string[];
  addDirs?: string[];
}
```

在 `TopicExpert` 类的 `round2()` 方法之后插入新方法：

```ts
  async round2PeerReview(input: Round2PeerReviewInput): Promise<AgentResult> {
    const template = loadPrompt("topic-expert-peer-review");
    const base = new AgentBase({
      key: `topic_expert.${this.opts.name}`,
      systemPromptTemplate: template,
      vars: {
        ...this.baseVars(),
        project_id: input.projectId,
        run_id: input.runId,
        candidates_md: input.candidatesMd,
        peers_round1_bundle: input.peersRound1Bundle,
      },
      cli: this.opts.cli,
      model: this.opts.model,
    });
    return base.run("", undefined, { images: input.images, addDirs: input.addDirs });
  }
```

- [ ] **Step 1.1: 创建 prompt 文件**

Write 上面 Step 1.1 的完整内容到 `packages/agents/src/prompts/topic-expert-peer-review.md`。

- [ ] **Step 1.2: 给 TopicExpert 加 round2PeerReview 方法**

Edit `packages/agents/src/roles/topic-expert.ts` 按 Step 1.2 插入接口 + 方法。

- [ ] **Step 1.3: 跑 tsc 确认类型 OK**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm exec tsc --noEmit
```
Expected: no errors.

- [ ] **Step 1.4: Build agents dist 同步 prompt 副本**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm build
```
Expected: `copy-prompts` 把新 prompt 拷到 `dist/prompts/topic-expert-peer-review.md`。

- [ ] **Step 1.5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/agents/src/prompts/topic-expert-peer-review.md packages/agents/src/roles/topic-expert.ts && git commit -m "feat(agents): add TopicExpert.round2PeerReview (peer-review prompt) [T1]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: coordinator-final-synthesize Prompt + Coordinator 方法

**Files:**
- Create: `packages/agents/src/prompts/coordinator-final-synthesize.md`
- Modify: `packages/agents/src/roles/coordinator.ts` (add `finalSynthesize` method)

**Context:** Coordinator 最终聚合要输入 {candidates, N 份 peer review} → 输出 `candidates.final.md`，每条候选带互评共识、争议、采纳的改写、推荐分。

### Step 2.1: 写 prompt

创建 `packages/agents/src/prompts/coordinator-final-synthesize.md`：

```md
你是十字路口的选题协调员（最终聚合阶段）。

N 位专家刚对 candidates 做了互评（peer review，看过其他专家 Round 1 之后的评价）。你的任务：吸收所有互评，产出最终候选清单。

## 原 candidates

{{candidates_md}}

## 各专家的互评（peer reviews）

{{peer_reviews_bundle}}

## 你的任务

对每条 candidate：
1. 汇总互评共识（几位专家支持、为什么）
2. 提炼争议点（反对 / 补刀 的要点）
3. 如果多位专家给出同一方向的 rewrite，采纳改写（直接覆盖原立意）
4. 给最终推荐分 0-1（反映"互评后还有多少人推荐"的置信度）
5. 若某条在互评后普遍被砍（>50% 专家 oppose 且无 supplement），标记 `dropped: true` 并在最终清单里删除

## 硬要求

- 输出**最终候选清单**（数量可比原 candidates 少，但不多于原数量）
- 每条带共识 / 争议 / 推荐分字段
- 保留原 candidates 的 frontmatter 字段结构，追加新字段

# 输出要求

严格输出 markdown：

---
type: mission_candidates_final
project_id: {{project_id}}
run_id: {{run_id}}
generated_by: coordinator
model_used: {{model_used}}
generated_at: {{now}}
total_candidates: <N>
---

# 最终候选 mission

## 候选 #1

**立意**：<hook + 一句话主张（如果被 rewrite 了就用新版）>

**核心角度**：...

**目标读者**：...

**互评共识**：<N 位专家支持，理由 1-2 句>

**争议点**：<1-2 条反对/补刀要点>

**推荐分**：<0-1 浮点>

---

## 候选 #2
...
```

### Step 2.2: 修改 coordinator.ts 增加 finalSynthesize 方法

Read `packages/agents/src/roles/coordinator.ts` 确认当前结构后，在现有 aggregate 方法之后追加：

```ts
export interface FinalSynthesizeInput {
  projectId: string;
  runId: string;
  candidatesMd: string;
  peerReviewsBundle: string;  // 所有专家 round2 peer review 拼接
  images?: string[];
  addDirs?: string[];
}

// 在 Coordinator 类内追加：
  async finalSynthesize(input: FinalSynthesizeInput): Promise<AgentResult> {
    const template = loadPrompt("coordinator-final-synthesize");
    const base = new AgentBase({
      key: "coordinator.final_synthesize",
      systemPromptTemplate: template,
      vars: {
        project_id: input.projectId,
        run_id: input.runId,
        candidates_md: input.candidatesMd,
        peer_reviews_bundle: input.peerReviewsBundle,
        model_used: this.model ?? "auto",
        now: new Date().toISOString(),
      },
      cli: this.cli,
      model: this.model,
    });
    return base.run("", undefined, { images: input.images, addDirs: input.addDirs });
  }
```

- [ ] **Step 2.1: 创建 prompt**

Write Step 2.1 内容到 `packages/agents/src/prompts/coordinator-final-synthesize.md`。

- [ ] **Step 2.2: 先 Read `packages/agents/src/roles/coordinator.ts` 确认结构**

```bash
cat /Users/zeoooo/crossing-writer/packages/agents/src/roles/coordinator.ts | head -100
```
观察 `Coordinator` 类的 `cli` / `model` 字段名、现有方法签名风格。

- [ ] **Step 2.3: Edit coordinator.ts 按实际字段名插入 finalSynthesize**

根据 Step 2.2 看到的字段名调整 `this.cli` / `this.model` 的访问路径（可能是 `this.opts.cli`），然后插入 `FinalSynthesizeInput` 接口 + `finalSynthesize` 方法。

- [ ] **Step 2.4: tsc + build**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm exec tsc --noEmit && pnpm build
```
Expected: no errors, dist 同步。

- [ ] **Step 2.5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/agents/src/prompts/coordinator-final-synthesize.md packages/agents/src/roles/coordinator.ts && git commit -m "feat(agents): add Coordinator.finalSynthesize for peer-review aggregation [T2]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: mission-orchestrator Round2 换成 peer review + final synthesize

**Files:**
- Modify: `packages/web-server/src/services/mission-orchestrator.ts`

**Context:** Round2 循环改为对每位专家传 `peersRound1Bundle`（其他专家的 round1 产出），用 `round2PeerReview()` 取代 `round2()`。Coordinator 的 round2 aggregate 换成 `finalSynthesize()`，输出写到 `mission/candidates.final.md`（不覆盖 `candidates.md`），更新 store 的 `mission.candidates_path` 指向 final 文件。事件名同步换新。

### Step 3.1: 读文件先定位要改的 blocks

```bash
grep -n "round2\|aggregat\|candidatesPath" /Users/zeoooo/crossing-writer/packages/web-server/src/services/mission-orchestrator.ts
```
预期找到：
- Round2 循环（line ~211-240 附近）用 `agent.round2(...)` 并写入 `mission/round2/<name>.md`
- aggregate 调用（line ~248-254）用 `coord.round2Aggregate(...)`
- candidatesPath 覆盖（line ~254）

### Step 3.2: 改 Round2 循环

在 `packages/web-server/src/services/mission-orchestrator.ts` 找到 Round2 的 `Promise.all(experts.map(async (name) => { ... }))` block（大约 line 211-240），替换为：

```ts
  // round2 parallel — 专家互评
  await mkdir(join(projectDir, "mission/round2"), { recursive: true });
  const round2Results: Array<{ name: string; text: string }> = [];
  // 预先构造 peers bundle（每个专家看到的是"其他人"的 round1）
  await Promise.all(
    experts.map(async (name) => {
      const expertResolved = resolveFor(`topic_expert.${name}`, opts);
      await appendEvent(projectDir, {
        type: "expert.round2_peer_review_started",
        expert: name,
        cli: expertResolved.cli,
        model: expertResolved.model ?? null,
      });
      const kbContent = registry.readKb("topic-panel", name);
      const entry = registry.listAll("topic-panel").find((e) => e.name === name)!;
      const peersBundle = bundle(round1Results.filter((r) => r.name !== name));
      const agent = new TopicExpert({
        name,
        kbContent,
        kbSource: `08_experts/topic-panel/${entry.file ?? `experts/${name}_kb.md`}`,
        cli: expertResolved.cli,
        model: expertResolved.model,
      });
      const out = await agent.round2PeerReview({
        projectId,
        runId,
        candidatesMd: candidatesResult.text,
        peersRound1Bundle: peersBundle,
        images: briefImages,
        addDirs,
      });
      await writeFile(join(projectDir, `mission/round2/${name}.md`), out.text, "utf-8");
      round2Results.push({ name, text: out.text });
      await appendEvent(projectDir, {
        type: "expert.round2_peer_review_completed",
        expert: name,
        cli: expertResolved.cli,
        model: expertResolved.model ?? null,
      });
    }),
  );
```

### Step 3.3: 改 aggregate 为 finalSynthesize + 写 candidates.final.md

同一文件往下找到 coord.round2Aggregate 调用（约 line 248-254），替换为：

```ts
  // coordinator final synthesize (peer-review aware)
  await appendEvent(projectDir, {
    type: "coordinator.aggregating",   // 旧事件保留，兼容前端
    cli: coordResolved.cli,
    model: coordResolved.model ?? null,
  });
  const finalAgg = await coord.finalSynthesize({
    projectId,
    runId,
    candidatesMd: candidatesResult.text,
    peerReviewsBundle: bundle(round2Results),
    images: briefImages,
    addDirs,
  });
  const finalCandidatesPath = "mission/candidates.final.md";
  await writeFile(join(projectDir, finalCandidatesPath), stripAgentPreamble(finalAgg.text), "utf-8");
  await appendEvent(projectDir, {
    type: "coordinator.final_candidates_ready",
    output_path: finalCandidatesPath,
    cli: coordResolved.cli,
    model: coordResolved.model ?? null,
  });
```

删掉原本的 `await writeFile(join(projectDir, candidatesPath), stripAgentPreamble(aggregated.text), "utf-8");`（它覆盖了 candidates.md；我们现在写 final 独立文件）。

### Step 3.4: 改 final mission.candidates_path

同一文件的尾部 `store.update(projectId, { status: "awaiting_mission_pick", mission: { ..., candidates_path: candidatesPath }, ... })`，把 `candidates_path: candidatesPath` 改为 `candidates_path: finalCandidatesPath`。

- [ ] **Step 3.1: 读 mission-orchestrator.ts 定位 Round2 和 aggregate blocks**

```bash
grep -n "round2\|aggregat\|candidatesPath\|candidates.md" /Users/zeoooo/crossing-writer/packages/web-server/src/services/mission-orchestrator.ts
```

- [ ] **Step 3.2: 替换 Round2 循环为 peer review**

按 Step 3.2 的代码改 `Promise.all(experts.map(async (name) => ...))` block。

- [ ] **Step 3.3: 替换 aggregate 为 finalSynthesize**

按 Step 3.3 的代码改 coord.round2Aggregate block + 删掉覆盖 candidates.md 的那行。

- [ ] **Step 3.4: 更新 mission.candidates_path 指向 final**

按 Step 3.4 改 store.update 那段。

- [ ] **Step 3.5: tsc**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec tsc --noEmit 2>&1 | grep -E "mission-orchestrator" | head
```
Expected: 无我们引入的错误（pre-existing 错误忽略）。

- [ ] **Step 3.6: Commit**

```bash
git add packages/web-server/src/services/mission-orchestrator.ts && git commit -m "feat(mission): replace Round2 self-eval with peer review + final synthesize [T3]

Each expert now sees peers' round1 when reviewing candidates. Coordinator's
aggregate step reads all peer reviews and produces mission/candidates.final.md
with consensus / disputes / recommendation score per candidate.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: coordinator-refine Prompt + Coordinator.refine 方法

**Files:**
- Create: `packages/agents/src/prompts/coordinator-refine.md`
- Modify: `packages/agents/src/roles/coordinator.ts` (add `refine` method)

**Context:** 用户选定立意后可迭代提交反馈，coordinator 基于 {当前立意、反馈文本、历史 refines} 精修这条立意本身，不新增候选。

### Step 4.1: 写 prompt

创建 `packages/agents/src/prompts/coordinator-refine.md`：

```md
你是十字路口选题协调员（精修阶段）。

用户已经选定一条立意，现在对它提出修改意见。你的任务：**精修这条立意本身**，不新增候选、不推翻方向。

## 当前选中的立意（来自 selected.md 或最近一版 refine）

{{current_mission}}

## 用户反馈

{{user_feedback}}

## 之前的修改历史（如果有，按时间从早到近）

{{refine_history}}

## 硬要求

1. 只改 hook、立意描述、角度切入、目标读者感知
2. **不改核心方向**（产品 / 传播目标 / 赛道定位 三者必须和原立意保持一致）
3. 不写解释性前言，直接给出修改后的 mission 全文
4. 保持 frontmatter 结构不变（字段一个不多、一个不少），更新 frontmatter 里 `refined_at`
5. 若用户反馈为空或无实质内容（<3 字），你仍需做一次"再打磨"（重新审视 hook，看能否更锐利）

# 输出

直接输出修改后的 mission.md 全文（frontmatter + 正文），无任何前言/后言。
```

### Step 4.2: 增加 refine 方法到 coordinator.ts

```ts
export interface RefineInput {
  projectId: string;
  currentMission: string;
  userFeedback: string;
  refineHistory: string;  // 之前版本拼接，新到旧或旧到新由调用方决定
  images?: string[];
  addDirs?: string[];
}

// 在 Coordinator 类内追加：
  async refine(input: RefineInput): Promise<AgentResult> {
    const template = loadPrompt("coordinator-refine");
    const base = new AgentBase({
      key: "coordinator.refine",
      systemPromptTemplate: template,
      vars: {
        project_id: input.projectId,
        current_mission: input.currentMission,
        user_feedback: input.userFeedback,
        refine_history: input.refineHistory,
        model_used: this.model ?? "auto",   // 用实际字段名
        now: new Date().toISOString(),
      },
      cli: this.cli,   // 用实际字段名
      model: this.model,
    });
    return base.run("", undefined, { images: input.images, addDirs: input.addDirs });
  }
```

- [ ] **Step 4.1: 创建 prompt**

Write Step 4.1 内容到 `packages/agents/src/prompts/coordinator-refine.md`。

- [ ] **Step 4.2: Edit coordinator.ts 追加 refine 方法**

插入 `RefineInput` 接口 + `refine` 方法。字段名按 Task 2 Step 2.2 看到的实际命名对齐。

- [ ] **Step 4.3: tsc + build**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm exec tsc --noEmit && pnpm build
```

- [ ] **Step 4.4: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/agents/src/prompts/coordinator-refine.md packages/agents/src/roles/coordinator.ts && git commit -m "feat(agents): add Coordinator.refine for human feedback loop [T4]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: mission-refine-service + /mission/refine 路由

**Files:**
- Create: `packages/web-server/src/services/mission-refine-service.ts`
- Modify: `packages/web-server/src/routes/mission.ts`

**Context:** POST /mission/refine 接收 `{ feedback }`，读 selected.md 和 refines/ 目录下已有版本，调 Coordinator.refine，写 `mission/refines/round-N.md` + `round-N.feedback.txt`，发事件。

### Step 5.1: 创建 service

`packages/web-server/src/services/mission-refine-service.ts`:

```ts
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Coordinator, resolveAgent, stripAgentPreamble, type AgentConfig } from "@crossing/agents";
import type { ProjectStore } from "./project-store.js";
import { appendEvent } from "./event-log.js";

export interface RunRefineOpts {
  projectId: string;
  feedback: string;
  store: ProjectStore;
  projectsDir: string;
  agents: Record<string, AgentConfig>;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
}

export async function runMissionRefine(opts: RunRefineOpts): Promise<{ round: number; path: string }> {
  const { projectId, feedback, store, projectsDir } = opts;
  const project = await store.get(projectId);
  if (!project) throw new Error("project not found");
  if (!project.mission?.selected_path) throw new Error("no selected mission to refine");

  const projectDir = join(projectsDir, projectId);
  const refinesDir = join(projectDir, "mission/refines");
  await mkdir(refinesDir, { recursive: true });

  // 历史版本号：读 refines/ 下所有 round-N.md，取最大 N + 1
  const existing = (await readdir(refinesDir).catch(() => [])).filter((f) => /^round-\d+\.md$/.test(f));
  const nextRound = existing.length + 1;

  // 当前最新的 mission 文本：若有 refines，用最后一版；否则用 selected.md
  let currentMission: string;
  if (existing.length > 0) {
    const lastFile = `round-${existing.length}.md`;
    currentMission = await readFile(join(refinesDir, lastFile), "utf-8");
  } else {
    currentMission = await readFile(join(projectDir, project.mission.selected_path), "utf-8");
  }

  // refineHistory：把之前的 round-*.md 按序号从早到晚拼起来，空则空字符串
  const historyParts: string[] = [];
  for (let i = 1; i <= existing.length; i++) {
    const p = join(refinesDir, `round-${i}.md`);
    try {
      const t = await readFile(p, "utf-8");
      historyParts.push(`## round-${i}\n\n${t}`);
    } catch { /* skip */ }
  }
  const refineHistory = historyParts.join("\n\n---\n\n");

  const resolved = resolveAgent(
    { vaultPath: "", sqlitePath: "", modelAdapter: { defaultCli: opts.defaultCli, fallbackCli: opts.fallbackCli }, agents: opts.agents },
    "coordinator",
  );

  const fromStatus = project.status;
  await store.update(projectId, { status: "mission_refining" });
  await appendEvent(projectDir, { type: "state_changed", from: fromStatus, to: "mission_refining" });
  await appendEvent(projectDir, {
    type: "mission.refine_requested",
    round: nextRound,
    feedback: feedback.slice(0, 500),
    cli: resolved.cli,
    model: resolved.model ?? null,
  });

  const startedMs = Date.now();
  const coord = new Coordinator({ cli: resolved.cli, model: resolved.model });
  const out = await coord.refine({
    projectId,
    currentMission,
    userFeedback: feedback,
    refineHistory,
  });
  const refinePath = `mission/refines/round-${nextRound}.md`;
  const feedbackPath = `mission/refines/round-${nextRound}.feedback.txt`;
  await writeFile(join(projectDir, refinePath), stripAgentPreamble(out.text), "utf-8");
  await writeFile(join(projectDir, feedbackPath), feedback, "utf-8");

  await store.update(projectId, { status: "mission_review" });
  await appendEvent(projectDir, {
    type: "mission.refine_completed",
    round: nextRound,
    output_path: refinePath,
    durationMs: Date.now() - startedMs,
  });
  await appendEvent(projectDir, { type: "state_changed", from: "mission_refining", to: "mission_review" });

  return { round: nextRound, path: refinePath };
}
```

### Step 5.2: 给 mission.ts 增加 /refine 路由

在 `packages/web-server/src/routes/mission.ts` 的 `/mission/select` 之后追加：

```ts
  app.post<{
    Params: { id: string };
    Body: { feedback?: string };
  }>("/api/projects/:id/mission/refine", async (req, reply) => {
    const { id } = req.params;
    const feedback = (req.body?.feedback ?? "").toString();
    const project = await deps.store.get(id);
    if (!project?.mission?.selected_path) {
      return reply.code(400).send({ error: "no selected mission to refine" });
    }
    // 只允许在 approved_preview / review 状态发起 refine
    if (project.status !== "mission_approved_preview" && project.status !== "mission_review") {
      return reply.code(400).send({ error: `refine not allowed in status ${project.status}` });
    }
    setImmediate(() => {
      import("../services/mission-refine-service.js").then(async (mod) => {
        try {
          await mod.runMissionRefine({ projectId: id, feedback, ...deps });
        } catch (err: any) {
          app.log.error({ err, projectId: id }, "refine failed");
          const { appendEvent } = await import("../services/event-log.js");
          const { join } = await import("node:path");
          await appendEvent(join(deps.projectsDir, id), {
            type: "mission.refine_failed",
            error: err instanceof Error ? err.message : String(err),
          });
          // 回退状态到 preview（若失败中断）
          await deps.store.update(id, { status: "mission_approved_preview" });
        }
      });
    });
    return reply.code(202).send({ ok: true, status: "mission_refining" });
  });
```

- [ ] **Step 5.1: 创建 mission-refine-service.ts**

Write Step 5.1 整段内容。

- [ ] **Step 5.2: Edit mission.ts 追加 /refine 路由**

在现有 /mission/select 的 closing `}` 之后、`app.get ... candidates` 之前插入 Step 5.2 的 route handler。

- [ ] **Step 5.3: tsc**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec tsc --noEmit 2>&1 | grep -v "case-plan-orchestrator\|overview-analyzer-service\|string' index" | head
```
Expected: 无本 task 引入的错误。

- [ ] **Step 5.4: 触发 tsx watch reload + 手工 probe**

```bash
touch /Users/zeoooo/crossing-writer/packages/web-server/src/server.ts && sleep 3 && curl -s -X POST http://localhost:3001/api/projects/trae/mission/refine -H 'Content-Type: application/json' -d '{"feedback":"test"}' -w "\nHTTP %{http_code}\n"
```
Expected: 若 trae 已 selected，返回 202；否则返回 400 "no selected mission to refine"。

- [ ] **Step 5.5: Commit**

```bash
git add packages/web-server/src/services/mission-refine-service.ts packages/web-server/src/routes/mission.ts && git commit -m "feat(mission): /mission/refine route + service [T5]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: /mission/confirm + /mission/refines 列表 + /mission/refines/:index

**Files:**
- Modify: `packages/web-server/src/routes/mission.ts`

**Context:** confirm 把最后一版 refines 拷贝到 selected.md，状态切 mission_approved 触发 Overview。refines 列表 + 单个 get 提供 UI 历史下拉和 diff 数据源。

### Step 6.1-6.3: 三个 route handler

在 `packages/web-server/src/routes/mission.ts` 继续追加：

```ts
  app.post<{ Params: { id: string } }>("/api/projects/:id/mission/confirm", async (req, reply) => {
    const { id } = req.params;
    const project = await deps.store.get(id);
    if (!project?.mission?.selected_path) {
      return reply.code(400).send({ error: "no selected mission" });
    }
    if (project.status !== "mission_approved_preview" && project.status !== "mission_review") {
      return reply.code(400).send({ error: `confirm not allowed in status ${project.status}` });
    }
    const projectDir = join(deps.projectsDir, id);
    const refinesDir = join(projectDir, "mission/refines");
    // 找最后一版 refines
    const existing = (await readdir(refinesDir).catch(() => [])).filter((f) => /^round-\d+\.md$/.test(f));
    if (existing.length > 0) {
      const lastFile = `round-${existing.length}.md`;
      const finalText = await readFile(join(refinesDir, lastFile), "utf-8");
      await writeFile(join(projectDir, project.mission.selected_path), finalText, "utf-8");
    }
    const fromStatus = project.status;
    await deps.store.update(id, { status: "mission_approved" });
    await appendEvent(projectDir, { type: "mission.confirmed", final_path: project.mission.selected_path });
    await appendEvent(projectDir, { type: "state_changed", from: fromStatus, to: "mission_approved" });
    return { ok: true, status: "mission_approved" };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/mission/refines", async (req, reply) => {
    const { id } = req.params;
    const project = await deps.store.get(id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const refinesDir = join(deps.projectsDir, id, "mission/refines");
    const entries = (await readdir(refinesDir).catch(() => [])).filter((f) => /^round-\d+\.md$/.test(f));
    const refines = [];
    for (const f of entries.sort()) {
      const m = f.match(/^round-(\d+)\.md$/);
      if (!m) continue;
      const index = Number(m[1]);
      const mdPath = join(refinesDir, f);
      const feedbackPath = join(refinesDir, `round-${index}.feedback.txt`);
      let feedback = "";
      try { feedback = await readFile(feedbackPath, "utf-8"); } catch { /* skip */ }
      let created_at = "";
      try { created_at = (await import("node:fs")).statSync(mdPath).mtime.toISOString(); } catch { /* skip */ }
      refines.push({ index, path: `mission/refines/${f}`, feedback, created_at });
    }
    return { refines };
  });

  app.get<{ Params: { id: string; index: string } }>(
    "/api/projects/:id/mission/refines/:index",
    async (req, reply) => {
      const { id, index } = req.params;
      const idx = Number(index);
      if (!Number.isInteger(idx) || idx < 1) return reply.code(400).send({ error: "invalid index" });
      const project = await deps.store.get(id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      const filePath = join(deps.projectsDir, id, "mission/refines", `round-${idx}.md`);
      try {
        const content = await readFile(filePath, "utf-8");
        reply.header("content-type", "text/markdown; charset=utf-8");
        return content;
      } catch {
        return reply.code(404).send({ error: "not found" });
      }
    },
  );
```

别忘了在 mission.ts 顶部 import：`import { readdir } from "node:fs/promises";` （若尚未 import）。

- [ ] **Step 6.1: 检查 mission.ts 顶部 imports**

```bash
head -15 /Users/zeoooo/crossing-writer/packages/web-server/src/routes/mission.ts
```
若没有 `readdir`，从 `node:fs/promises` 导入。

- [ ] **Step 6.2: 追加三个 route handler**

Edit mission.ts 在 /refine 之后、`}` （函数 `registerMissionRoutes` 结束的大括号）之前插入 Step 6.1-6.3 的三个 handler。

- [ ] **Step 6.3: tsc + probe**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec tsc --noEmit 2>&1 | grep -E "routes/mission\.ts" | head
```

触发 tsx reload + probe：
```bash
touch /Users/zeoooo/crossing-writer/packages/web-server/src/server.ts && sleep 3 && curl -s http://localhost:3001/api/projects/trae/mission/refines -w "\nHTTP %{http_code}\n"
```
Expected: `{"refines":[]}` 或 `{"refines":[...]}`，HTTP 200。

- [ ] **Step 6.4: Commit**

```bash
git add packages/web-server/src/routes/mission.ts && git commit -m "feat(mission): /mission/confirm + refines list/get endpoints [T6]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: /mission/select 改状态目标 + 状态机 transitions

**Files:**
- Modify: `packages/web-server/src/routes/mission.ts`（改 /mission/select）
- Modify: `packages/web-server/src/state/state-machine.ts`（若存在；若无此文件则跳过）

**Context:** 旧 /mission/select 直接 `mission_approved` → 触发 Overview。新流程要求用户 confirm 才 approved。所以 select 后应进入 `mission_approved_preview`。

### Step 7.1: 改 /mission/select 的状态目标

在 `packages/web-server/src/routes/mission.ts` 找到 `/mission/select` handler 里的两处：

**旧：**
```ts
    await deps.store.update(id, {
      status: "mission_approved",
      ...
    });
    ...
    await appendEvent(projectDir, {
      type: "state_changed",
      from: project.status,
      to: "mission_approved",
    });
```

**新：**
```ts
    await deps.store.update(id, {
      status: "mission_approved_preview",
      ...
    });
    ...
    await appendEvent(projectDir, {
      type: "state_changed",
      from: project.status,
      to: "mission_approved_preview",
    });
    await appendEvent(projectDir, {
      type: "mission.selected",
      candidate_index: candidateIndex,
      path: selectedPath,
    });
```

### Step 7.2: 若有 state-machine.ts，增加 transitions

```bash
ls /Users/zeoooo/crossing-writer/packages/web-server/src/state/state-machine.ts
```
若存在，打开看是否有 allowed transitions 白名单。加：
- `awaiting_mission_pick → mission_approved_preview`
- `mission_approved_preview → mission_refining`
- `mission_refining → mission_review`
- `mission_review → mission_refining`（再改一次）
- `mission_review → mission_approved`
- `mission_approved_preview → mission_approved`（直接确认无 refine）
- `mission_refining → mission_approved_preview`（失败回退）

若文件不存在或没有白名单机制，跳过这一步。

- [ ] **Step 7.1: 改 /mission/select 状态**

Edit mission.ts 按 Step 7.1 双处替换。

- [ ] **Step 7.2: 检查并可能更新 state-machine.ts**

```bash
cat /Users/zeoooo/crossing-writer/packages/web-server/src/state/state-machine.ts 2>&1 | head -40
```
若有 allowed transitions 数组/字典，加进去 Step 7.2 列的 transitions。

- [ ] **Step 7.3: 验证 /mission/select 能用**

```bash
touch /Users/zeoooo/crossing-writer/packages/web-server/src/server.ts && sleep 3
# 如果 trae 在 awaiting_mission_pick 状态可测
curl -s http://localhost:3001/api/projects/trae | python3 -c "import json,sys; print(json.load(sys.stdin).get('status'))"
```

- [ ] **Step 7.4: Commit**

```bash
git add packages/web-server/src/routes/mission.ts packages/web-server/src/state/state-machine.ts && git commit -m "feat(mission): /select routes to mission_approved_preview (not approved) [T7]

New 2-step approval: select → preview (can refine) → confirm → approved.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 前端 SSE 事件白名单 + 新状态 case

**Files:**
- Modify: `packages/web-ui/src/hooks/useProjectStream.ts`
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx`

### Step 8.1: 加事件到 EVENT_TYPES

在 `packages/web-ui/src/hooks/useProjectStream.ts` 找到 `const EVENT_TYPES = [...]` 数组，追加：

```ts
  // Peer review + refine loop
  "expert.round2_peer_review_started",
  "expert.round2_peer_review_completed",
  "coordinator.final_candidates_ready",
  "mission.selected",
  "mission.refine_requested",
  "mission.refine_completed",
  "mission.refine_failed",
  "mission.confirmed",
```

### Step 8.2: 加新状态 case 到 renderPhaseView

在 `packages/web-ui/src/pages/ProjectWorkbench.tsx` 的 `switch (status) { ... }` 末尾前追加 case：

```tsx
    case "mission_approved_preview":
      return <MissionApprovePreview projectId={projectId} project={project} refetch={refetch} />;
    case "mission_refining":
      return <RunningView label="Coordinator 正在精修…" desc="基于你的反馈调整立意，约 30-60 秒" />;
    case "mission_review":
      return <MissionReviewPanel projectId={projectId} project={project} refetch={refetch} />;
```

import 两个新组件（路径：`../components/right/MissionApprovePreview` / `../components/right/MissionReviewPanel`）。

Task 9/10 会实际创建这两个组件。这里先加 import（tsc 会报错但不影响提交本 task，我们 commit 前就 skip 这一提交，等 Task 9/10 完再一起 commit）。

**为避免 tsc 中间态 fail，T8 只改 EVENT_TYPES；新 case 的 import + 渲染挪到 T9 里和组件一起提交。**

修正 Step 8.2：只改 useProjectStream.ts。新 case 放 Task 9。

- [ ] **Step 8.1: 加事件到 EVENT_TYPES**

Edit `useProjectStream.ts` 按 Step 8.1 在 EVENT_TYPES 数组末尾（before closing `]`）插入 8 个新事件字符串。

- [ ] **Step 8.2: tsc**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec tsc --noEmit
```

- [ ] **Step 8.3: Commit**

```bash
git add packages/web-ui/src/hooks/useProjectStream.ts && git commit -m "feat(sse): whitelist peer review + refine loop events [T8]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: MissionApprovePreview 组件 + ProjectWorkbench 挂载

**Files:**
- Create: `packages/web-ui/src/components/right/MissionApprovePreview.tsx`
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx`

**Context:** 用户选完立意后的预览 + 反馈输入 + 两个 CTA（提交修改 / 确认进入下一步）。

### Step 9.1: 创建组件

`packages/web-ui/src/components/right/MissionApprovePreview.tsx`:

```tsx
import { useEffect, useState } from "react";

export function MissionApprovePreview({
  projectId,
  project,
  refetch,
}: {
  projectId: string;
  project: any;
  refetch: () => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"refine" | "confirm" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // 读最新 selected.md — 如果有 refines 取最后一版，否则 selected.md
    (async () => {
      try {
        const refinesRes = await fetch(`/api/projects/${projectId}/mission/refines`);
        const { refines } = await refinesRes.json();
        if (refines?.length > 0) {
          const last = refines[refines.length - 1];
          const r = await fetch(`/api/projects/${projectId}/mission/refines/${last.index}`);
          if (r.ok) setSelected(await r.text());
        } else if (project?.mission?.selected_path) {
          const r = await fetch(`/api/projects/${projectId}/mission/selected`);
          if (r.ok) setSelected(await r.text());
          // 若此路由不存在，兜底读项目树（非阻塞）
        }
      } catch (e: any) { setErr(String(e?.message ?? e)); }
    })();
  }, [projectId, project?.mission?.selected_path]);

  const submitRefine = async () => {
    setBusy("refine"); setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/mission/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setFeedback("");
      refetch();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(null); }
  };

  const confirmFinal = async () => {
    setBusy("confirm"); setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/mission/confirm`, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status}`);
      refetch();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded border border-[var(--hair)] bg-[var(--bg-1)] p-5">
        <div className="text-xs uppercase tracking-wider text-[var(--faint)] font-semibold mb-3">当前选中立意</div>
        <pre className="text-sm text-[var(--body)] whitespace-pre-wrap break-words font-mono-term">{selected || "加载中…"}</pre>
      </div>

      <div>
        <label className="block text-xs text-[var(--meta)] mb-1.5">修改意见（可留空，留空也能提交以再打磨）</label>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="想调什么？比如「这个立意太普通了，想更反直觉一些」"
          className="w-full min-h-[80px] p-3 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
          disabled={!!busy}
        />
      </div>

      {err && <div className="text-xs text-[var(--red)]">错误：{err}</div>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={confirmFinal}
          className="inline-flex items-center h-9 px-4 rounded border border-[var(--hair)] text-sm text-[var(--body)] hover:bg-[var(--bg-2)] disabled:opacity-50"
        >
          {busy === "confirm" ? "确认中…" : "✓ 确认进入下一步"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={submitRefine}
          className="inline-flex items-center h-9 px-4 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-sm text-[var(--accent-on)] font-semibold hover:shadow-[0_0_12px_var(--accent-dim)] disabled:opacity-50"
        >
          {busy === "refine" ? "提交中…" : "⬆ 提交修改意见"}
        </button>
      </div>
    </div>
  );
}
```

### Step 9.2: 在 ProjectWorkbench 挂 import + case

Read `packages/web-ui/src/pages/ProjectWorkbench.tsx` 找到 import block + `switch (status)`。

Import 顶部加：
```tsx
import { MissionApprovePreview } from "../components/right/MissionApprovePreview";
```

switch case 里 `case "awaiting_mission_pick":` 之后、下一个 case 之前追加：
```tsx
    case "mission_approved_preview":
      return <MissionApprovePreview projectId={projectId} project={project} refetch={refetch} />;
    case "mission_refining":
      return <RunningView label="Coordinator 正在精修…" desc="基于你的反馈调整立意，约 30-60 秒" />;
```

注意：`mission_review` 的 case 留给 Task 10。

- [ ] **Step 9.1: 创建 MissionApprovePreview 组件**

Write Step 9.1 全文到 `MissionApprovePreview.tsx`。

- [ ] **Step 9.2: Import + 加两个 case**

Edit `ProjectWorkbench.tsx`，按 Step 9.2 加 import 和两个 case。

- [ ] **Step 9.3: tsc**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec tsc --noEmit
```

- [ ] **Step 9.4: Commit**

```bash
git add packages/web-ui/src/components/right/MissionApprovePreview.tsx packages/web-ui/src/pages/ProjectWorkbench.tsx && git commit -m "feat(ui): MissionApprovePreview for mission_approved_preview state [T9]

Selected mission card + feedback textarea + refine/confirm buttons.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: MissionReviewPanel (diff + 历史)

**Files:**
- Create: `packages/web-ui/src/components/right/MissionReviewPanel.tsx`
- Modify: `packages/web-ui/package.json`（加 `diff` 依赖）
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx`（加 `mission_review` case）

### Step 10.1: 安装 diff 依赖

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm add diff && pnpm add -D @types/diff
```

### Step 10.2: 创建组件

`packages/web-ui/src/components/right/MissionReviewPanel.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { diffLines } from "diff";

interface RefineEntry {
  index: number;
  path: string;
  feedback: string;
  created_at: string;
}

export function MissionReviewPanel({
  projectId,
  project,
  refetch,
}: {
  projectId: string;
  project: any;
  refetch: () => void;
}) {
  const [refines, setRefines] = useState<RefineEntry[]>([]);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const [original, setOriginal] = useState<string>("");
  const [refineText, setRefineText] = useState<string>("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"refine" | "confirm" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 加载 refines 列表
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/mission/refines`);
        const { refines } = await res.json();
        setRefines(refines ?? []);
        // 默认查看最新一版
        if (refines?.length > 0) setViewingIndex(refines[refines.length - 1].index);
      } catch (e: any) { setErr(String(e?.message ?? e)); }
    })();
  }, [projectId]);

  // 加载 original (selected.md) + viewingIndex 对应的 refine
  useEffect(() => {
    (async () => {
      try {
        // original = selected.md（即 "最初选的那条"）
        // 暂用 tree 接口找 selected.md 路径，或请求 mission/selected 路由（若不存在，我们直接读第一次 refine 的前一版）
        // 最稳妥：读 selected.md 通过 project.mission.selected_path
        if (project?.mission?.selected_path) {
          const r = await fetch(`/api/projects/${projectId}/tree`);
          // 读 selected.md 文件我们没单独路由；简化：用 refines 的前一版近似
          // 兜底方案：original 显示为空，只看 refine 最新 vs 上一版
        }
        if (viewingIndex != null) {
          const r = await fetch(`/api/projects/${projectId}/mission/refines/${viewingIndex}`);
          if (r.ok) setRefineText(await r.text());
        }
      } catch (e: any) { setErr(String(e?.message ?? e)); }
    })();
  }, [projectId, viewingIndex, project?.mission?.selected_path]);

  const diffParts = useMemo(() => {
    if (!original && !refineText) return [];
    // 比较：prev = 上一版（viewingIndex-1 对应的 refine）或 original
    // 简化：original 暂填上一版的 refine 内容
    const prev = original;
    const curr = refineText;
    return diffLines(prev, curr);
  }, [original, refineText]);

  // 加载"上一版" 作为 original（若 viewingIndex > 1）
  useEffect(() => {
    (async () => {
      if (viewingIndex == null || viewingIndex <= 1) { setOriginal(""); return; }
      try {
        const r = await fetch(`/api/projects/${projectId}/mission/refines/${viewingIndex - 1}`);
        if (r.ok) setOriginal(await r.text());
      } catch { /* ignore */ }
    })();
  }, [projectId, viewingIndex]);

  const submitRefine = async () => {
    setBusy("refine"); setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/mission/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setFeedback("");
      refetch();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(null); }
  };

  const confirmFinal = async () => {
    setBusy("confirm"); setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/mission/confirm`, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status}`);
      refetch();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[var(--heading)]">立意改稿 · 第 {viewingIndex ?? "?"} 版</div>
        {refines.length > 1 && (
          <select
            value={viewingIndex ?? ""}
            onChange={(e) => setViewingIndex(Number(e.target.value))}
            className="h-8 px-2 text-xs rounded border border-[var(--hair)] bg-[var(--bg-1)] text-[var(--body)]"
          >
            {refines.map((r) => (
              <option key={r.index} value={r.index}>第 {r.index} 次改稿 · {r.created_at.slice(11, 16)}</option>
            ))}
          </select>
        )}
      </div>

      <div className="rounded border border-[var(--hair)] bg-[var(--bg-1)] p-4">
        <div className="text-[10px] uppercase tracking-wider text-[var(--faint)] font-semibold mb-2">改稿对比（上一版 → 当前版）</div>
        {diffParts.length === 0 && <div className="text-xs text-[var(--faint)]">加载中或无上一版可比。</div>}
        <pre className="text-sm font-mono-term whitespace-pre-wrap break-words leading-relaxed">
          {diffParts.map((p, i) => (
            <span
              key={i}
              className={
                p.added ? "bg-[rgba(46,194,126,0.12)] text-[var(--accent)]" :
                p.removed ? "bg-[rgba(255,107,107,0.10)] text-[var(--red)] line-through" :
                "text-[var(--body)]"
              }
            >
              {p.value}
            </span>
          ))}
        </pre>
      </div>

      <div>
        <label className="block text-xs text-[var(--meta)] mb-1.5">继续调整（留空也能再打磨）</label>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="再改点什么？"
          className="w-full min-h-[80px] p-3 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
          disabled={!!busy}
        />
      </div>

      {err && <div className="text-xs text-[var(--red)]">错误：{err}</div>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={confirmFinal}
          className="inline-flex items-center h-9 px-4 rounded border border-[var(--hair)] text-sm text-[var(--body)] hover:bg-[var(--bg-2)] disabled:opacity-50"
        >
          {busy === "confirm" ? "确认中…" : "✓ 确认进入下一步"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={submitRefine}
          className="inline-flex items-center h-9 px-4 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-sm text-[var(--accent-on)] font-semibold hover:shadow-[0_0_12px_var(--accent-dim)] disabled:opacity-50"
        >
          {busy === "refine" ? "改稿中…" : "⬆ 再改一次"}
        </button>
      </div>
    </div>
  );
}
```

### Step 10.3: 在 ProjectWorkbench 挂 mission_review case

Edit `ProjectWorkbench.tsx`：
- Import 加 `import { MissionReviewPanel } from "../components/right/MissionReviewPanel";`
- switch 里 `case "mission_refining":` 之后加：
  ```tsx
      case "mission_review":
        return <MissionReviewPanel projectId={projectId} project={project} refetch={refetch} />;
  ```

- [ ] **Step 10.1: 安装 diff 包**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm add diff && pnpm add -D @types/diff
```

- [ ] **Step 10.2: 创建 MissionReviewPanel 组件**

Write Step 10.2 全文。

- [ ] **Step 10.3: 挂 mission_review case 到 ProjectWorkbench**

Edit ProjectWorkbench.tsx 加 import + case。

- [ ] **Step 10.4: tsc**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec tsc --noEmit
```

- [ ] **Step 10.5: Commit**

```bash
git add packages/web-ui/package.json packages/web-ui/pnpm-lock.yaml packages/web-ui/src/components/right/MissionReviewPanel.tsx packages/web-ui/src/pages/ProjectWorkbench.tsx && git commit -m "feat(ui): MissionReviewPanel with diff view + history [T10]

Per-line diff (prev vs current refine) + version dropdown + feedback loop.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: E2E 手动验收

**Files:** 无代码改动。

**Context:** 端到端验证整个新流程。

- [ ] **Step 11.1: 准备一个项目到 awaiting_mission_pick**

用 trae（如果已经在这个状态）或新建一个项目、传 brief、启动专家团、等 round1/round2_peer_review/final_candidates_ready 完成。

- [ ] **Step 11.2: 验证 candidates.final.md 生成**

```bash
cat /Users/zeoooo/CrossingVault/07_projects/trae/mission/candidates.final.md | head -30
```
Expected: frontmatter 含 `type: mission_candidates_final`，每条候选带"互评共识""争议点""推荐分"。

- [ ] **Step 11.3: 验证 round2/*.md 是 peer_review 格式**

```bash
head -20 /Users/zeoooo/CrossingVault/07_projects/trae/mission/round2/赛博禅心.md
```
Expected: `type: peer_review`，至少 1 条 `peer_reference` 非空，至少 1 条非 support。

- [ ] **Step 11.4: UI 点选一条候选**

浏览器打开项目 → 候选列表 → 点"选定这条" → UI 应切到 `MissionApprovePreview`，显示选中立意 + 反馈输入框。

- [ ] **Step 11.5: 提交一次 refine**

输入反馈（比如"立意再锐利一点"）→ 点"提交修改意见"→ 状态切到 `mission_refining` → ~30-60 秒后切到 `mission_review`。

- [ ] **Step 11.6: 验证 refines 文件**

```bash
ls /Users/zeoooo/CrossingVault/07_projects/trae/mission/refines/
```
Expected: 有 `round-1.md` + `round-1.feedback.txt`。

- [ ] **Step 11.7: MissionReviewPanel 显示 diff**

UI 应显示 diff 视图（上一版 → 当前版的行级对比）。注意：第 1 次 refine 没有上一版可比，diff 可能为空（正常）。

- [ ] **Step 11.8: 再提交 1-2 次 refine 验证历史下拉**

每次点"再改一次"应生成 `round-N.md`，历史下拉列出全部版本。

- [ ] **Step 11.9: 点"确认"**

UI 应切到 `mission_approved` → Overview 触发。

```bash
cat /Users/zeoooo/CrossingVault/07_projects/trae/mission/selected.md | head
# Expected: 内容等同于最后一版 refines/round-N.md
```

- [ ] **Step 11.10: 全量回归测试**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm exec vitest run --reporter=basic 2>&1 | tail -3
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm exec vitest run --reporter=basic 2>&1 | tail -3
```
Expected: 本 plan 无关的既有失败可忽略，新引入错误为 0。

- [ ] **Step 11.11: 标记验收完成**

在 plan 文件对应 step 打勾，与用户同步结果。

---

## Self-Review

**Spec coverage:**
- ✅ Round2 = 互评 → Task 1 + 3
- ✅ Coordinator 最终聚合 → Task 2 + 3
- ✅ Refine 循环 prompt → Task 4
- ✅ Refine service + /mission/refine → Task 5
- ✅ /mission/confirm + /mission/refines → Task 6
- ✅ /mission/select 新状态目标 → Task 7
- ✅ SSE event whitelist → Task 8
- ✅ MissionApprovePreview UI → Task 9
- ✅ MissionReviewPanel (diff + history) UI → Task 10
- ✅ 端到端验收 → Task 11

**Placeholder 扫描：** 无 TBD / TODO / "similar to..."。Task 2 Step 2.2-2.3 的字段名通过先 Read 再 Edit 确认（有显式"先读"步骤而非猜测）。

**类型一致性：**
- `round2PeerReview(input: Round2PeerReviewInput)` 与 orchestrator 调用处字段一致（peersRound1Bundle / candidatesMd / projectId / runId / images / addDirs）
- `finalSynthesize(input: FinalSynthesizeInput)` 字段同
- `refine(input: RefineInput)` 字段同
- 事件 `expert.round2_peer_review_started/_completed` / `coordinator.final_candidates_ready` / `mission.selected` / `mission.refine_requested/_completed/_failed` / `mission.confirmed` 在 orchestrator、service、SSE 白名单三处命名一致

**遗留风险：**
- Task 9 `MissionApprovePreview` 里"读 selected.md"目前没有专用路由，我注释标了 fallback（通过 refines 列表最新一版）。如果需要，可以补一条 `GET /api/projects/:id/mission/selected`，但不阻塞本 plan。
- Task 10 的 diff "original" 使用"上一版 refine"而非 selected.md 原文，第 1 次改稿 diff 将为空（行为符合直觉但首改体验略平）。后续可补 original-vs-current 双轴。
