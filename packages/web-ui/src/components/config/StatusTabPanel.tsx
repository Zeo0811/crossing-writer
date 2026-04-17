import { useCliHealth } from "../../hooks/useCliHealth";

export function StatusTabPanel() {
  const { data: health } = useCliHealth();
  const tools = [
    { name: "search_wiki", desc: "知识库 FTS 检索", attached: "Writer agent" },
    { name: "search_raw", desc: "原始素材检索", attached: "Writer agent" },
    { name: "kb.search", desc: "KB 查询", attached: "Topic Expert" },
  ];
  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs uppercase tracking-wide text-[var(--meta)] mb-2">CLI 健康</div>
        <div className="grid grid-cols-2 gap-3">
          {(["claude", "codex"] as const).map((c) => (
            <div key={c} className="rounded bg-[var(--bg-2)] p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold" style={{ fontFamily: "var(--font-mono)" }}>
                  {c}
                </div>
                <span
                  className={`text-[10px] ${
                    health?.[c]?.status === "online"
                      ? "text-[var(--accent)]"
                      : "text-[var(--red)]"
                  }`}
                >
                  {health?.[c]?.status ?? "—"}
                </span>
              </div>
              <div
                className="text-xs text-[var(--meta)]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {health?.[c]?.version ?? "—"}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="text-xs uppercase tracking-wide text-[var(--meta)] mb-2">工具集</div>
        <div className="space-y-2">
          {tools.map((t) => (
            <div
              key={t.name}
              className="flex items-center gap-3 px-3 py-2.5 rounded bg-[var(--bg-2)]"
            >
              <code
                className="text-sm text-[var(--accent)]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {t.name}
              </code>
              <span className="text-sm text-[var(--body)] flex-1">{t.desc}</span>
              <span className="text-xs text-[var(--meta)]">{t.attached}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
