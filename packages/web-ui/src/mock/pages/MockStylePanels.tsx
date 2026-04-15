import { useState } from "react";

interface StylePanel {
  id: string;
  account: string;
  role: "voice" | "structure" | "tone";
  version: number;
  summary: string;
  updated: string;
}

const PANELS: StylePanel[] = [
  { id: "s-1", account: "@KojiTalks", role: "voice", version: 4, summary: "克制 · 第一人称深度 · 不下结论 · 偶尔自嘲", updated: "今天" },
  { id: "s-2", account: "@KojiTalks", role: "structure", version: 2, summary: "开场 1 句锚 + 3-5 case 推进 + 收束 1 个反问", updated: "3 天前" },
  { id: "s-3", account: "@TopGeeky", role: "voice", version: 3, summary: "硬核 · 量化驱动 · 偏程序员幽默", updated: "1 周前" },
  { id: "s-4", account: "@独立开发拾遗", role: "tone", version: 1, summary: "亲切 · 多用「我们」· 拒绝大词", updated: "2 周前" },
];

const ROLE_LABEL: Record<StylePanel["role"], string> = { voice: "声音", structure: "结构", tone: "口吻" };

export function MockStylePanels() {
  const [active, setActive] = useState<string>(PANELS[0]!.id);
  const cur = PANELS.find((p) => p.id === active)!;
  return (
    <div className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-base text-[var(--heading)] font-semibold">风格库</h1>
        <button className="px-3 py-1.5 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] text-xs font-semibold">＋ 蒸馏新风格</button>
      </header>
      <div className="grid grid-cols-[260px_1fr] min-h-[480px]">
        <aside className="border-r border-[var(--hair)] p-3 space-y-1.5">
          {PANELS.map((p) => (
            <button
              key={p.id}
              onClick={() => setActive(p.id)}
              className={`w-full text-left p-2.5 rounded text-xs ${active === p.id ? "bg-[var(--accent-fill)] text-[var(--heading)]" : "hover:bg-[var(--bg-2)] text-[var(--body)]"}`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-semibold">{p.account}</span>
                <span className="text-[10px] text-[var(--faint)]">v{p.version}</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-[var(--meta)]">
                <span className="px-1.5 py-0.5 rounded-sm bg-[var(--bg-1)]">{ROLE_LABEL[p.role]}</span>
                <span>·</span>
                <span>{p.updated}</span>
              </div>
            </button>
          ))}
        </aside>
        <main className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg text-[var(--heading)] font-semibold">{cur.account}</h2>
            <span className="text-xs px-2 py-0.5 rounded-sm bg-[var(--bg-2)] text-[var(--meta)]">{ROLE_LABEL[cur.role]} · v{cur.version}</span>
          </div>
          <div className="rounded bg-[var(--bg-2)] p-4">
            <div className="text-xs text-[var(--meta)] mb-2 font-semibold">摘要</div>
            <p className="text-sm text-[var(--body)]">{cur.summary}</p>
          </div>
          <div className="rounded bg-[var(--bg-2)] p-4 space-y-2">
            <div className="text-xs text-[var(--meta)] font-semibold">高频用词</div>
            <div className="flex flex-wrap gap-1.5">
              {["其实", "我觉得", "克制", "不至于", "工作流", "人为啥要", "说白了"].map((w) => (
                <span key={w} className="text-[11px] px-2 py-0.5 rounded-sm bg-[var(--bg-1)] text-[var(--accent)]">{w}</span>
              ))}
            </div>
          </div>
          <div className="rounded bg-[var(--bg-2)] p-4">
            <div className="text-xs text-[var(--meta)] mb-2 font-semibold">3 段示例（来自历史稿件）</div>
            <ul className="space-y-2 text-sm text-[var(--body)] list-decimal list-inside">
              <li>"工具不是中性的，它塑造你怎么想。"</li>
              <li>"我很想给一个结论，但今天先不给。"</li>
              <li>"它做到了 80%，剩下的 20% 是我的事。"</li>
            </ul>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-4 py-2 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold">应用到当前项目</button>
            <button className="px-4 py-2 rounded border border-[var(--hair-strong)] text-[var(--meta)] text-sm">重新蒸馏</button>
            <button className="px-4 py-2 rounded text-[var(--red)] hover:bg-[rgba(255,107,107,0.1)] text-sm">归档</button>
          </div>
        </main>
      </div>
    </div>
  );
}
