import { useMock } from "../MockProvider";
import { HERO_STATUSES } from "../fixtures/projects";

export function MockStateSwitcher() {
  const m = useMock();
  if (!m.switcherOpen) {
    return (
      <button
        onClick={() => m.setSwitcherOpen(true)}
        title="打开演示控制台"
        className="fixed bottom-4 right-4 z-30 w-9 h-9 rounded-full border border-[var(--accent-soft)] bg-[var(--bg-1)] text-[var(--accent)] hover:bg-[var(--accent-fill)] flex items-center justify-center text-base"
      >
        ⚙
      </button>
    );
  }
  return (
    <div
      className="fixed bottom-4 right-4 z-30 w-[280px] rounded border border-[var(--accent-soft)] bg-[var(--bg-1)] shadow-[0_8px_24px_rgba(0,0,0,0.4)] overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--accent-fill)] border-b border-[var(--accent-soft)]">
        <span className="text-xs text-[var(--accent)] font-semibold">演示控制台</span>
        <button
          onClick={() => m.setSwitcherOpen(false)}
          className="text-[var(--meta)] hover:text-[var(--heading)] text-xs"
        >
          ─
        </button>
      </div>
      <div className="p-3 space-y-3">
        <div>
          <div className="text-[11px] text-[var(--meta)] mb-1.5">主角项目状态</div>
          <select
            value={m.heroStatus}
            onChange={(e) => m.setHeroStatus(e.target.value as any)}
            className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-2 py-1 text-xs text-[var(--body)] outline-none focus:border-[var(--accent)]"
          >
            {HERO_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}（{s.id}）</option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-[11px] text-[var(--meta)] mb-1.5">CLI 状态</div>
          <div className="flex gap-1">
            {(["ok", "slow", "down"] as const).map((h) => (
              <button
                key={h}
                onClick={() => m.setCliHealth(h)}
                className={`flex-1 px-2 py-1 text-[11px] rounded border ${
                  m.cliHealth === h
                    ? "border-[var(--accent)] bg-[var(--accent-fill)] text-[var(--accent)]"
                    : "border-[var(--hair)] text-[var(--meta)] hover:border-[var(--hair-strong)]"
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--meta)] mb-1.5">Toast 演示</div>
          <div className="flex gap-1">
            <button onClick={() => m.pushToast({ type: "success", message: "Brief 解析完成" })} className="flex-1 px-2 py-1 text-[11px] rounded border border-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent-fill)]">success</button>
            <button onClick={() => m.pushToast({ type: "error", message: "Mission 生成失败：CLI 超时" })} className="flex-1 px-2 py-1 text-[11px] rounded border border-[var(--red)] text-[var(--red)] hover:bg-[rgba(255,107,107,0.1)]">error</button>
            <button onClick={() => m.pushToast({ type: "info", message: "正在重新解析…" })} className="flex-1 px-2 py-1 text-[11px] rounded border border-[var(--amber-hair)] text-[var(--amber)] hover:bg-[var(--amber-bg)]">info</button>
          </div>
        </div>
        <div className="text-[10px] text-[var(--faint)] leading-relaxed">
          按 ⌘K 唤起命令面板。主角项目状态会驱动 Workbench 视图。
        </div>
      </div>
    </div>
  );
}
