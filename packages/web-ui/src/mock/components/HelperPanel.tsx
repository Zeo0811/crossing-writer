import type { HeroStatus } from "../fixtures/projects";

const HINTS: Partial<Record<HeroStatus, { title: string; body: string; eta?: string }>> = {
  created: {
    title: "上传 brief",
    body: "把甲方给的 brief（PDF / DOCX / 截图 / 文本均可）丢进来。",
    eta: "提交后约 30 秒解析完成",
  },
  brief_uploaded: { title: "已收到", body: "Brief Analyst 即将开始解析。" },
  brief_analyzing: { title: "正在解析", body: "Brief Analyst (claude) 在抽取产品名 / 调性 / 卖点。" },
  brief_ready: { title: "Brief 就绪", body: "下一步：挑一位 Mission 专家，开始第一轮选题。" },
  awaiting_expert_selection: { title: "挑专家", body: "选一位 Mission 专家主导第一轮选题。" },
  round1_running: { title: "第一轮思考", body: "三位专家并行在生成各自的角度。", eta: "约 1-2 分钟" },
  round1_failed: { title: "第一轮失败", body: "可重试或换 CLI / 模型。" },
  synthesizing: { title: "综合中", body: "Coordinator 在合并三位专家的产出。" },
  round2_running: { title: "第二轮收敛", body: "把综合稿打回三位专家做二次审视。", eta: "约 1 分钟" },
  awaiting_mission_pick: { title: "挑选题", body: "从候选里挑一条作为本次选题，或重新生成。" },
  mission_approved: { title: "选题已定", body: "下一步：补充产品官方资料生成概览。" },
  awaiting_overview_input: { title: "补充信息", body: "把官网/试用链接/手记交给 Overview Analyst。" },
  overview_analyzing: { title: "概览生成中", body: "Overview Analyst 正在抓取并归纳。", eta: "约 1 分钟" },
  overview_ready: { title: "概览就绪", body: "确认无误后挑 Case 专家。" },
  awaiting_case_expert_selection: { title: "挑专家", body: "选一位 Case 专家主导用例规划。" },
  case_planning_running: { title: "Case 规划中", body: "并行生成多版 case 大纲。" },
  case_synthesizing: { title: "Case 综合中", body: "正在收敛成最终 case 列表。" },
  awaiting_case_selection: { title: "挑 Case", body: "勾选要带入正文的 case。" },
  case_plan_approved: { title: "Case 已批准", body: "去跑真实测，把截图 / 录屏 / 笔记传到每个 case 下。" },
  evidence_collecting: { title: "Evidence 收集", body: "每个 case 至少一份截图 + 一份笔记。" },
  evidence_ready: { title: "Evidence 齐备", body: "可进入写作配置。" },
  writing_configuring: { title: "写作配置", body: "选作者风格、写作专家。" },
  writing_running: { title: "写作中", body: "Writer 正在分段生成。", eta: "5-10 分钟" },
  writing_ready: { title: "初稿就绪", body: "可逐段编辑、Selection rewrite、@-mention skill。" },
  writing_editing: { title: "正在编辑", body: "改完会自动重新合稿。" },
  writing_failed: { title: "写作失败", body: "查看日志，必要时重跑该段。" },
};

export function HelperPanel({ status }: { status: HeroStatus }) {
  const h = HINTS[status] ?? { title: "下一步", body: "继续推进流程。" };
  return (
    <aside className="rounded bg-[var(--bg-2)] p-4 space-y-3">
      <div>
        <div className="text-xs text-[var(--meta)] font-semibold mb-1.5">提示</div>
        <div className="text-[var(--heading)] font-semibold text-sm">{h.title}</div>
        <p className="text-xs text-[var(--meta)] leading-relaxed mt-1.5">{h.body}</p>
      </div>
      {h.eta && (
        <div className="text-[10px] text-[var(--accent)] flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          {h.eta}
        </div>
      )}
    </aside>
  );
}
