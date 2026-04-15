export interface MissionCandidate {
  id: string;
  title: string;
  hook: string;
  why: string;
  angle: string;
}

export const MISSION_CANDIDATES: MissionCandidate[] = [
  {
    id: "mc-1",
    title: "AI 写代码的真正分水岭，是「我让它干什么」",
    hook: "Cursor 不是更聪明的补全器，它是一个能「接管整段任务」的同事。",
    why: "把「工具升级」叙事换成「权责变化」叙事，避开同质化跑分。",
    angle: "权责变化",
  },
  {
    id: "mc-2",
    title: "Cursor 让独立开发者重新成为可能",
    hook: "一个人配三个 agent，做完了我去年带 5 人小队的活。",
    why: "面向独立开发者群体的实用主义视角，转化率高。",
    angle: "个人生产力",
  },
  {
    id: "mc-3",
    title: "我把 Cursor 关掉一周，发现自己已经不会写代码了",
    hook: "比「被 AI 替代」更值得警惕的，是「被 AI 重塑」。",
    why: "反向叙事制造话题感，配合「克制使用 AI」的人文视角。",
    angle: "反向警示",
  },
];

export interface CaseCandidate {
  id: string;
  title: string;
  description: string;
  expectedDuration: string;
  difficulty: "简单" | "中等" | "硬核";
  selected?: boolean;
}

export const CASE_CANDIDATES: CaseCandidate[] = [
  { id: "cc-1", title: "把一个废弃的 Python 脚本改成 Web 服务", description: "选一段 200 行不带文档的老脚本，让 Cursor 三步内拆出 API。", expectedDuration: "30 分钟", difficulty: "中等", selected: true },
  { id: "cc-2", title: "复现一个 GitHub issue 并提交 PR", description: "找 starred 项目的真实 issue，让 Cursor 全程主导。", expectedDuration: "1 小时", difficulty: "硬核", selected: true },
  { id: "cc-3", title: "把一篇论文的算法实现成可运行 demo", description: "给定一篇 10 页的 ML 论文，验证 Cursor 抽象→代码的能力。", expectedDuration: "2 小时", difficulty: "硬核", selected: true },
  { id: "cc-4", title: "故意写垃圾代码看 Cursor 怎么救", description: "塞 5 个反模式进同一个文件，看 refactor 建议有多狠。", expectedDuration: "20 分钟", difficulty: "简单", selected: false },
  { id: "cc-5", title: "在没网的飞机上用 Cursor", description: "拔网线测离线降级行为，记录 UX 损失。", expectedDuration: "40 分钟", difficulty: "简单", selected: false },
];
