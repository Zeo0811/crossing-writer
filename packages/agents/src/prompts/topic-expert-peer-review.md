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
