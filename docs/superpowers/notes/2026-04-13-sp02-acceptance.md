# SP-02 Acceptance (MetaNovas smoke)

Date: <填写>
Total duration: <填写> min

## 手工走查步骤

1. 启动服务：
   ```bash
   cd /Users/zeoooo/crossing-writer-sp02
   pnpm dev
   ```
2. 浏览器 `localhost:3000` → 新建项目 "MetaNovas 实测 (SP-02 smoke)"
3. 粘贴 `samples/briefs/metanovas-sample.md` 内容到右侧 BriefIntakeForm；产品名 MetaClaw
4. 点"开始解析 Brief"。等左侧出现 brief-summary（约 1-2 分钟）
5. 右侧弹 ExpertSelector，默认勾选 2 位（赛博禅心 + 卡兹克），点"开跑两轮评审"
6. 右侧时间线依次出现：refs_pack → expert.round1 × 2 → synthesizing → candidates_ready → expert.round2 × 2 → awaiting_mission_pick
7. 左侧出现 3 个候选 Mission，挑一个点"采用这个"
8. 左侧进入 SelectedMissionView，顶部状态 `mission_approved`

## 验收勾选

- [ ] brief-summary.md 字段齐全（type/brand/product/goal/audience/key_messages/tone/deliverables/confidence）
- [ ] 3 个候选 Mission 角度差异明显（不是三个都同一个切入）
- [ ] round2 评分聚合后 candidates.md 里 `final_order` / `round2_rankings` 已填
- [ ] selected.md 有 frontmatter + `selected_index`，SP-03 可消费
- [ ] 整个流程时间线所有事件都出现（>= 10 个事件）
- [ ] 刷新浏览器恢复到正确状态（不丢数据）

## 实测数据

- brief_analyzing 耗时：
- round1 并行耗时（最慢一位专家）：
- synthesizing 耗时：
- round2 并行耗时：
- round2_aggregate 耗时：
- codex CLI 失败次数：
- 是否需要手动重试：

## 发现的问题

（填写）

## 产出文件清单（vault 下）

```
~/CrossingVault/07_projects/metanovas-实测-sp-02-smoke/
  project.json
  events.jsonl
  brief/
    raw/brief.txt
    brief.md
    brief-summary.md
  context/
    refs-pack.md
  mission/
    round1/赛博禅心.md
    round1/数字生命卡兹克.md
    candidates.md
    round2/赛博禅心.md
    round2/数字生命卡兹克.md
    selected.md
```

## Verdict

- [ ] 通过
- [ ] 阻塞（需 fix）
