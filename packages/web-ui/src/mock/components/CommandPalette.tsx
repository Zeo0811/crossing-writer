import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMock } from "../MockProvider";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: "导航" | "操作" | "项目";
  run: () => void;
}

export function CommandPalette() {
  const m = useMock();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (m.paletteOpen) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [m.paletteOpen]);

  const commands: Command[] = useMemo(() => {
    const list: Command[] = [
      { id: "nav-projects", group: "导航", label: "Projects 列表", hint: "/", run: () => nav("/mock") },
      { id: "nav-knowledge", group: "导航", label: "Knowledge", hint: "/knowledge", run: () => nav("/mock/knowledge") },
      { id: "nav-style", group: "导航", label: "Style Panels", hint: "/style-panels", run: () => nav("/mock/style-panels") },
      { id: "nav-config", group: "导航", label: "Config Workbench", hint: "/config", run: () => nav("/mock/config") },
      { id: "nav-settings", group: "导航", label: "Settings", hint: "/settings", run: () => nav("/mock/settings") },
      { id: "act-new", group: "操作", label: "新建项目", hint: "N", run: () => { nav("/mock"); m.pushToast({ type: "info", message: "演示：新建项目向导即将打开（Checkpoint 2）" }); } },
      { id: "act-theme", group: "操作", label: m.theme === "dark" ? "切到亮色主题" : "切到深色主题", run: () => m.toggleTheme() },
      { id: "act-toast-ok", group: "操作", label: "演示 success toast", run: () => m.pushToast({ type: "success", message: "✅ Brief 解析完成" }) },
      { id: "act-toast-err", group: "操作", label: "演示 error toast", run: () => m.pushToast({ type: "error", message: "Mission 生成失败：CLI 超时" }) },
    ];
    for (const p of m.projects) {
      list.push({
        id: `proj-${p.id}`, group: "项目", label: p.name, hint: p.product,
        run: () => nav(`/mock/projects/${p.id}`),
      });
    }
    return list;
  }, [m.projects, m.theme]);

  const filtered = useMemo(() => {
    if (!q.trim()) return commands;
    const t = q.toLowerCase();
    return commands.filter((c) => (c.label + " " + (c.hint ?? "")).toLowerCase().includes(t));
  }, [commands, q]);

  useEffect(() => { setIdx(0); }, [q]);

  if (!m.paletteOpen) return null;

  function run(c: Command) {
    c.run();
    m.setPaletteOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const c = filtered[idx]; if (c) run(c); }
    else if (e.key === "Escape") { m.setPaletteOpen(false); }
  }

  // group display
  const grouped: Record<string, Command[]> = {};
  for (const c of filtered) (grouped[c.group] ??= []).push(c);
  let runningIdx = 0;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center pt-[12vh] bg-[rgba(0,0,0,0.55)] backdrop-blur-sm"
      onClick={() => m.setPaletteOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[90vw] max-h-[70vh] flex flex-col rounded border border-[var(--hair-strong)] bg-[var(--bg-1)] shadow-[0_20px_60px_rgba(0,0,0,0.4)] overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--hair)]">
          <span className="text-[var(--accent)]">⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="输入命令、项目或操作…"
            className="flex-1 bg-transparent outline-none text-[var(--heading)] placeholder:text-[var(--faint)] text-sm"
          />
          <kbd
            className="px-1.5 py-0.5 text-[10px] rounded-sm border border-[var(--hair-strong)] bg-[var(--kbd-bg)] text-[var(--meta)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            esc
          </kbd>
        </div>
        <div className="overflow-y-auto py-1">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group}>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--faint)]">{group}</div>
              {items.map((c) => {
                const myIdx = runningIdx++;
                const active = myIdx === idx;
                return (
                  <button
                    key={c.id}
                    onMouseEnter={() => setIdx(myIdx)}
                    onClick={() => run(c)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left ${active ? "bg-[var(--accent-fill)] text-[var(--heading)]" : "text-[var(--body)] hover:bg-[var(--bg-2)]"}`}
                  >
                    <span className="flex-1">{c.label}</span>
                    {c.hint && <span className="text-[var(--faint)] text-xs">{c.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-[var(--faint)] text-sm">无匹配结果</div>
          )}
        </div>
        <div className="border-t border-[var(--hair)] px-3 py-1.5 flex items-center justify-between text-[10px] text-[var(--faint)]">
          <div className="flex items-center gap-3">
            <span><kbd className="px-1 border border-[var(--hair-strong)] rounded-sm">↑</kbd><kbd className="ml-0.5 px-1 border border-[var(--hair-strong)] rounded-sm">↓</kbd> 移动</span>
            <span><kbd className="px-1 border border-[var(--hair-strong)] rounded-sm">↵</kbd> 选中</span>
          </div>
          <span>{filtered.length} 项</span>
        </div>
      </div>
    </div>
  );
}
