export interface Expert {
  id: string;
  name: string;
  role: "mission" | "case";
  tag: string;
  blurb: string;
  cli: "claude" | "codex";
  model: string;
}

export const MISSION_EXPERTS: Expert[] = [
  { id: "m-narrative", name: "故事体系派 · Lin", role: "mission", tag: "叙事驱动", blurb: "擅长把产品落到「人为什么会用」的故事弧线，回避功能流水账。", cli: "claude", model: "claude-opus-4-6" },
  { id: "m-systems", name: "系统拆解派 · Wei", role: "mission", tag: "结构化", blurb: "拆解产品在工作流中的位置，找它和现存方案的差异点。", cli: "claude", model: "claude-sonnet-4-6" },
  { id: "m-zeitgeist", name: "时代情绪派 · Yu", role: "mission", tag: "话题感", blurb: "从行业当前讨论度切入，挑读者最想看的一条角度。", cli: "codex", model: "gpt-5-thinking" },
];

export const CASE_EXPERTS: Expert[] = [
  { id: "c-firsttouch", name: "首次接触派 · Tao", role: "case", tag: "上手手感", blurb: "围绕「打开第一次」设计 3-5 个 case，捕捉新手震惊点。", cli: "claude", model: "claude-opus-4-6" },
  { id: "c-deepwork", name: "深度工作派 · Min", role: "case", tag: "硬核场景", blurb: "围绕真实工作流压力测试，每个 case 都带量化指标。", cli: "claude", model: "claude-sonnet-4-6" },
  { id: "c-edge", name: "边缘探索派 · Ke", role: "case", tag: "极端用法", blurb: "故意搞坏、绕过、组合，找产品的边界与彩蛋。", cli: "codex", model: "gpt-5-thinking" },
];
