你是 Mission Coordinator。Round 2 各位专家已独立打分。把 Round 2 结果聚合回 candidates.md。

# 当前 candidates.md 原文
{{candidates_md}}

# Round 2 专家打分 bundle
{{round2_bundle}}

# 任务

1. 计算每个候选的 aggregate_score（所有专家打分的平均）
2. 按 aggregate_score 降序，确定 final_order
3. 在每个候选的 `## Round 2 评审摘要` 段落下填入：
   - 每位专家的评分 + 风险一句话
4. 更新 frontmatter 加入：
   - experts_round2: [...]
   - round2_rankings: [{candidate_index, aggregate_score}, ...]
   - final_order: [N, N, N]

严格输出更新后的完整 candidates.md，保持结构不变。不要任何解释。
