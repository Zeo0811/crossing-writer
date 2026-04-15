import { useState } from "react";

interface KnowledgeItem {
  id: string;
  title: string;
  source: string;
  type: "公众号" | "Twitter" | "笔记" | "文档";
  tags: string[];
  excerpt: string;
  ingestedAt: string;
}

const ITEMS: KnowledgeItem[] = [
  { id: "k-1", title: "AI agent 最让人困惑的，不是它做了什么", source: "@KojiTalks · 2026-04-12", type: "公众号", tags: ["agent", "深度", "认知"], excerpt: "我一开始以为问题是 agent 不够强，后来发现问题是我们没想清楚交付物。" , ingestedAt: "2 天前" },
  { id: "k-2", title: "Cursor Composer 实测 24 小时", source: "@TopGeeky · 2026-04-10", type: "公众号", tags: ["Cursor", "实测"], excerpt: "Composer 不是补全升级，是工作模式变更。" , ingestedAt: "4 天前" },
  { id: "k-3", title: "Lovable 一周心得", source: "本地笔记", type: "笔记", tags: ["Lovable", "建站"], excerpt: "前端拼装类产品的天花板正在被 AI 抹平。" , ingestedAt: "今天" },
  { id: "k-4", title: "Anthropic Claude 4.5 release notes", source: "anthropic.com", type: "文档", tags: ["Claude", "release"], excerpt: "Sonnet 4.5 在 agent 任务上接近 Opus 表现。" , ingestedAt: "1 周前" },
];

const TYPES = ["全部", "公众号", "Twitter", "笔记", "文档"] as const;

export function MockKnowledge() {
  const [type, setType] = useState<(typeof TYPES)[number]>("全部");
  const [q, setQ] = useState("");
  const visible = ITEMS.filter((i) => (type === "全部" || i.type === type) && (!q || (i.title + i.excerpt + i.tags.join(" ")).toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-base text-[var(--heading)] font-semibold">知识库</h1>
        <div className="flex items-center gap-2">
          <button className="text-xs text-[var(--meta)] hover:text-[var(--heading)]">导入素材</button>
          <button className="px-3 py-1.5 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] text-xs font-semibold">＋ 新建笔记</button>
        </div>
      </header>
      <div className="px-6 py-4 flex items-center gap-3 border-b border-[var(--hair)]">
        <div className="flex items-center gap-1 p-1 rounded border border-[var(--hair)]">
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`px-3 py-1 text-xs rounded ${type === t ? "bg-[var(--accent-fill)] text-[var(--accent)]" : "text-[var(--meta)] hover:text-[var(--heading)]"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1 relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索标题 / 标签 / 内容…"
            className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 pl-9 text-sm outline-none focus:border-[var(--accent-soft)]"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]">⌕</span>
        </div>
      </div>
      <main className="p-6 grid grid-cols-2 gap-4">
        {visible.map((it) => (
          <article key={it.id} className="rounded bg-[var(--bg-2)] p-4 hover:ring-1 hover:ring-[var(--accent-soft)] cursor-pointer">
            <div className="flex items-start justify-between mb-2 gap-2">
              <h3 className="text-sm font-semibold text-[var(--heading)]">{it.title}</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--bg-1)] text-[var(--meta)] whitespace-nowrap">{it.type}</span>
            </div>
            <p className="text-xs text-[var(--body)] leading-relaxed mb-3">{it.excerpt}</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {it.tags.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--bg-1)] text-[var(--meta)]">#{t}</span>
              ))}
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--faint)]">
              <span>{it.source}</span>
              <span>入库 {it.ingestedAt}</span>
            </div>
          </article>
        ))}
        {visible.length === 0 && (
          <div className="col-span-2 py-12 text-center text-[var(--meta)]">无匹配条目</div>
        )}
      </main>
    </div>
  );
}
