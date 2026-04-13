# SP-02 Vault Experts Setup

Date: 2026-04-13 (Task 17 of SP-02 execution)

## Done

1. Created directory structure:
   ```
   ~/CrossingVault/08_experts/
     topic-panel/
       SKILL.md                        ← from ai-kepu-panel
       experts/                        ← 10 × <name>_kb.md
       index.yaml                      ← active + preselect metadata
     style-panel/
       十字路口_kb.md                   ← already created during brainstorm
   ```

2. Copied from `/Users/zeoooo/Downloads/ai-kepu-panel/`:
   - `SKILL.md`
   - `expert_knowledge/*.md` (10 files, ~400 lines each, distilled from 1500 WeChat articles)

3. Wrote `topic-panel/index.yaml` with 10 experts, all `active: true`, 2 defaults preselected:
   - 赛博禅心 (深度分析)
   - 数字生命卡兹克 (实测感)

## Next (done elsewhere)

- Task 18: ExpertRegistry service reads `index.yaml` + exposes `/api/experts`
- Task 20: TopicExpert agent uses `readKb(name)` to load system prompt
