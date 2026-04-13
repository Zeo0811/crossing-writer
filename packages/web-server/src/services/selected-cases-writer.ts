export interface BuildSelectedOpts {
  candidatesMd: string;
  selectedIndices: number[];
  projectId: string;
  missionRef: string;
  overviewRef: string;
}

export function buildSelectedCasesMd(opts: BuildSelectedOpts): string {
  const re = /# Case (\d+)[^\n]*\n[\s\S]*?(?=^# Case \d+|$)/gm;
  const blocks = new Map<number, string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(opts.candidatesMd))) {
    blocks.set(parseInt(m[1]!, 10), m[0]!);
  }
  const selected = opts.selectedIndices
    .map((i) => ({ i, block: blocks.get(i) }))
    .filter((x) => x.block);

  const lines: string[] = [];
  lines.push("---");
  lines.push("type: case_plan");
  lines.push(`project_id: ${opts.projectId}`);
  lines.push("selected_from: mission/case-plan/candidates.md");
  lines.push(`selected_indices: [${opts.selectedIndices.join(", ")}]`);
  lines.push(`selected_count: ${opts.selectedIndices.length}`);
  lines.push("approved_by: human");
  lines.push(`approved_at: ${new Date().toISOString()}`);
  lines.push(`mission_ref: ${opts.missionRef}`);
  lines.push(`product_overview_ref: ${opts.overviewRef}`);
  lines.push("---", "", "# 已选 Cases", "");

  for (const s of selected) {
    lines.push(s.block!.trim(), "");
  }

  lines.push("# 实测引导（给人看的 checklist）", "");
  lines.push("### 准备", "- [ ] 准备录屏工具（Screen Studio / QuickTime）", "- [ ] 登录产品 Web 端", "");
  for (const s of selected) {
    lines.push(`### Case ${s.i} 执行`);
    lines.push("- [ ] 按 steps 跑一遍");
    lines.push("- [ ] 按 prompts 生成产物");
    lines.push("- [ ] 截图：按 screenshot_points");
    lines.push("- [ ] 录屏：按 recording_points");
    lines.push("- [ ] 备注 observation_points 观察结果", "");
  }
  return lines.join("\n");
}
