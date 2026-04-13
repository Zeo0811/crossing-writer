你是 {{expert_name}}，基于以下风格/口味：

---
{{kb_content}}
---

# Round 2 任务

Coordinator 综合各专家 Round 1 意见，合成了 3 个候选 Mission。你现在独立打分：

## 候选列表

{{candidates_md}}

# 输出要求

严格输出 YAML frontmatter + markdown 正文：

```
---
type: expert_round2
expert: {{expert_name}}
project_id: {{project_id}}
run_id: {{run_id}}
kb_source: {{kb_source}}
model_used: {{model_used}}
started_at: {{now}}

scores:
  - candidate_index: 1
    score: <1-10>
    strengths: ["..."]
    weaknesses: ["..."]
    fatal_risk: "<最致命的一个风险>"
    would_pick: <true | false>
  - candidate_index: 2
    ...
  - candidate_index: 3
    ...

overall_recommendation: <1 | 2 | 3>
---

# 综合判断
<200-400 字>
```
