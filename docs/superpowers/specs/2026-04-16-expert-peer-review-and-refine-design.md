# 专家团互评 + 人类纠偏循环 Design

Date: 2026-04-16
Owner: zeoooo
Status: draft

## 背景

当前 mission 流水线里 Round2 是"每位专家独立看 candidates.md 自评"——缺两个能力：

1. **专家之间没有对抗**。各自评 candidates 彼此看不到对方立场，coordinator 聚合时只能按加权平均，砍不掉抱团和盲点。
2. **用户选完立意后没有修改通道**。一旦 `awaiting_mission_pick` 进入下一步就是 Overview，用户若对选中那条有不满意的细节（hook 太普通、角度不够锐利），没有机制让 coordinator 再调一把。

两个问题合并处理：把 Round2 从"自评"改成"互评"（对抗性），再加一个"用户选完后的 refine 循环"。

## 目标

1. **Round2 替换为专家互评**：每位专家看 {candidates.md, peers' round1}，产出带对抗立场的评价，强制引用 peer 观点，不允许全部支持。
2. **Coordinator 最终聚合**：输入 {candidates, 互评全集} → `candidates.final.md`，每条带"共识 / 争议 / 采纳的改写"。
3. **人类纠偏循环**：用户选定一条立意后，可通过反馈输入框触发 coordinator 改稿，无限迭代，确认后进入 Overview。保留所有历史版本可追溯。

## 非目标

- 不改 Round1 的行为（仍是专家独立出候选）
- 不加循环次数上限
- 不支持"用户回到任一历史版本作为最终版"（永远用最后一版 refine）
- 不做专家团的"互评之互评"（避免串行化）
- 不改 Overview 及之后阶段

## 流水线对比

```
旧：
Round1(并行) → Coordinator综合 → Round2自评(并行) → Coordinator聚合 → awaiting_mission_pick → [用户选] → mission_approved → Overview

新：
Round1(并行) → Coordinator综合 → Round2互评(并行) → Coordinator最终聚合 → awaiting_mission_pick
                                                                            ↓ [用户选一条]
                                                                     mission_approved_preview
                                                                            ↓ [提交反馈]
                                                                       mission_refining
                                                                            ↓ [改稿完成]
                                                                        mission_review ⇆ (迭代)
                                                                            ↓ [用户确认]
                                                                        mission_approved → Overview
```

## 状态机

| 状态 | 触发事件 | 说明 |
|---|---|---|
| `round1_running` | 不变 | 并行跑 Round1 |
| `synthesizing` | 不变 | Coordinator 第一次综合 → `candidates.md` |
| `round2_running` | 不变 | **语义变了**：专家互评，不是自评 |
| `awaiting_mission_pick` | `coordinator.final_candidates_ready` | Coordinator 最终聚合后 |
| `mission_approved_preview` 🆕 | `mission.selected` | 用户选了一条，正在浏览/准备反馈 |
| `mission_refining` 🆕 | `mission.refine_requested` | Coordinator 正在改稿 |
| `mission_review` 🆕 | `mission.refine_completed` | 等用户看改稿 |
| `mission_approved` | `mission.confirmed` | 定稿，触发 Overview |

## 新增 / 改动事件

```
expert.round2_peer_review_started   (data: {expert, cli, model})
expert.round2_peer_review_completed (data: {expert, cli, model})
coordinator.final_candidates_ready  (data: {output_path, cli, model})
mission.selected                      (data: {candidate_index, path})
mission.refine_requested            (data: {round, feedback, cli, model})
mission.refine_completed            (data: {round, output_path, durationMs})
mission.confirmed                   (data: {final_path})
```

旧事件 `coordinator.candidates_ready` 保留（第一次综合用）；旧事件 `coordinator.aggregating` 删除（被 `coordinator.final_candidates_ready` 取代）。

## 互评 Prompt

每位专家 Round2 互评时的输入：

```
## 你自己的 Round1 产出
<expert_name.md 全文>

## 其他专家的 Round1 产出
- 专家 A: <A.md 正文>
- 专家 B: <B.md 正文>
...

## Coordinator 综合出的候选（你要评的对象）
<candidates.md 全文>

## 你的任务
对 candidates 每一条做出判断。

可选立场：
- support（支持）：说明为什么立意成立
- oppose（反对）：指出盲点 / 重复 / 角度不锐
- supplement（补刀）：@其他专家，点名引用 peer 观点
- rewrite（改写）：直接给出一句话新立意

## 硬要求
- 必须具名引用至少 1 条 peer 观点
- 不能全部 support——至少 1 条非 support
- 不能自评自己 Round1 的被采纳情况，只评 candidates
```

产出结构（`mission/round2/<expert>.md`）：

```yaml
---
type: peer_review
expert: <name>
round: 2
candidates_reviewed: <N>
---

## 对 candidates #1 的评价
stance: support | oppose | supplement | rewrite
reasoning: "..."
peer_reference: "@赛博禅心：他在 round1 的 X 观点值得融进这条"
rewritten_claim: null | "如果 stance=rewrite，给出新一句话立意"

## 对 candidates #2 的评价
...
```

## Coordinator 最终聚合 Prompt

输入：`candidates.md + {N 份 peer review}`
输出：重写 `candidates.final.md`，每条候选带：
- 原立意
- 互评共识（几位支持、为什么）
- 争议点（反对 / 补刀 的要点总结）
- 采纳后的改写（如果有 rewrite 被多数专家认同）
- 最终推荐分 0-1

## Refine Coordinator Prompt

```
你是十字路口选题协调员。用户已选定一条立意，对它提出修改意见。
你的任务：**精修这条立意本身**，不新增候选、不推翻方向。

## 当前选中的立意
<selected_mission.md 或最近一版 refines/round-N.md>

## 用户反馈
<feedback_text>

## 之前的修改历史（如有）
<refines/round-1.md>
<refines/round-2.md>
...

## 硬要求
- 只改 hook、立意描述、角度切入、目标读者感知
- 不改核心方向（产品 / 目标 / 赛道 不变）
- 不写解释性前言，直接给出修改后的 mission 全文
- 保持 frontmatter 结构不变

## 输出
修改后的 mission.md 全文（frontmatter + 正文）。
```

## 后端 API

| Endpoint | Method | Body | Returns |
|---|---|---|---|
| `/api/projects/:id/mission/select` | POST | `{ candidate_index: number }` | `200 { ok, status: "mission_approved_preview" }` |
| `/api/projects/:id/mission/refine` | POST | `{ feedback: string }` | `202 { ok, status: "mission_refining" }` |
| `/api/projects/:id/mission/confirm` | POST | — | `200 { ok, status: "mission_approved" }` |
| `/api/projects/:id/mission/refines` | GET | — | `{ refines: [{ index, path, feedback, created_at, durationMs }] }` |
| `/api/projects/:id/mission/refines/:index` | GET | — | `text/markdown` 某一版改稿 |

existing `/mission/start` 保持不变。`/mission/select` 已存在（写入 `mission/selected.md`，设 `selected_index` / `selected_path` / `selected_at` / `selected_by`），**改动点**：新的状态目标是 `mission_approved_preview` 不是原来的 `mission_approved`；`/mission/confirm` 才是进入 `mission_approved` 的入口。

## 文件落盘

```
mission/
├── round1/<expert>.md              # 不变
├── candidates.md                   # Coordinator 第一次综合（不变）
├── round2/<expert>.md              # 🔄 现在是互评产出（格式见 §互评 Prompt）
├── candidates.final.md             # 🆕 Coordinator 最终聚合（替代旧的覆盖 candidates.md）
├── selected.md             # 🆕 用户 POST /pick 时写入，candidate_index 指向的那条
└── refines/                        # 🆕 每次 refine 新目录
    ├── round-1.md                  # 第一次改稿产出
    ├── round-1.feedback.txt        # 对应的用户反馈原文
    ├── round-2.md
    ├── round-2.feedback.txt
    └── ...
```

确认时（POST /confirm）：把最后一版 `refines/round-N.md` 的内容**拷贝**回 `selected.md`（不移动，保留 refines/ 完整历史）。

## UI 交互

### `awaiting_mission_pick`（候选展示）

N 张候选卡片，每张带：
- 立意标题（hook）
- 核心主张
- 角度 / 目标读者
- 互评共识 + 争议（从 candidates.final.md 提取）
- 推荐分
- 主 CTA：`[✓ 选定这条]`

### `mission_approved_preview`（选完后）

- 大卡片展示选中立意（读 `selected.md`）
- 下方多行输入框，placeholder："想调什么？比如「这个立意太普通了，想更反直觉一些」"
- 两个 CTA：
  - `[⬆ 提交修改意见]` → POST /mission/refine
  - `[✓ 确认进入下一步]` → POST /mission/confirm

无字数下限（空输入也可以提交，coordinator 会当作"请你自己再打磨一次"）。

### `mission_review`（改稿回来）

- **Diff 视图**（行级）：原立意 vs 新立意，左右并排或上下对比
  - 绿色 = 新增 / 修改后的段落
  - 灰色 = 未变的段落
  - 红色 = 删除的段落
- 历史记录下拉：`📜 第 1 次改稿 · 第 2 次改稿 · ...` 可回看任意一版（只读，确认最终用的是最后一版）
- 输入框 + `[⬆ 再改一次]` + `[✓ 确认进入下一步]`

### Diff 实现

用 `diff` npm 库（`diffLines`），per-line 算法。单次 refine 全文通常 < 5KB，性能不是问题。

## 验收

1. mission 流水线 Round2 产出的 `round2/<expert>.md` frontmatter 是 `type: peer_review`，每份至少 1 条非 support 立场、至少 1 条 peer_reference
2. `candidates.final.md` 每条候选带"共识 / 争议 / 推荐分"字段
3. 用户选一条后进入 `mission_approved_preview` 状态（不是旧的 `mission_approved`）
4. 点"提交修改意见" → 状态切到 `mission_refining` → coordinator 产 `refines/round-N.md` → 切到 `mission_review`
5. `mission_review` 下能看到 diff + 历史版本下拉
6. 多次 refine（至少 3 次）历史全在 `refines/` 下、UI 都能回看
7. 点"确认" → `selected.md` 被最后一版 refines 覆盖 → 状态 `mission_approved` → Overview 触发
8. 空反馈也能提交（不报 400），coordinator 会基于"用户表达不明"做轻微调整

## 风险 / 边界

- **Refine 无限循环** → 文件数无上限，但 refines/ 目录大小最坏情况几 MB，可接受。UI 历史下拉如果超过 10 版可以折叠"早期版本"避免冗长。
- **互评 prompt 的"硬要求"**（必须具名引用 peer） → 需要实测几次看 claude 会不会在 peer 少于 2 人时违反（比如只有 1 个专家时没法 @ peer）。建议：如果 experts.length < 2，跳过互评硬要求，退化成 Round1 产出直接给 coordinator 最终聚合。
- **diff 视图** → 长立意（>2KB）换行密集时视觉会乱。加 max-height + scroll。
- **refines 编号与 round2 编号易混淆** → 文档里都写清"Round2 = 专家互评，refines/round-N = 第 N 次人类纠偏"，前端 UI 别用"Round"字样给 refines。
