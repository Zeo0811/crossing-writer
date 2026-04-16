import { useState } from "react";
import type { DistillRole } from "../../api/style-panels-client.js";

export interface DistillFormProps {
  account: string;
  totalInRange: number;
  onCancel: () => void;
  onSubmit: (body: { roles: DistillRole[]; limit?: number }) => void;
}

const ROLE_OPTIONS: Array<{ key: DistillRole; label: string; desc: string; color: string }> = [
  { key: "opening", label: "开头", desc: "钩子 / 悬念 / 场景化提问", color: "var(--accent)" },
  { key: "practice", label: "Case", desc: "实测段落、demo、prompt 文本", color: "var(--amber)" },
  { key: "closing", label: "结尾", desc: "收束 / 金句 / 回声钩子", color: "var(--pink)" },
];

export function DistillForm({ account, totalInRange, onCancel, onSubmit }: DistillFormProps) {
  const [selected, setSelected] = useState<Set<DistillRole>>(new Set(["opening", "practice", "closing"]));
  const [limit, setLimit] = useState<number>(Math.min(50, totalInRange));
  const [error, setError] = useState<string | null>(null);

  function toggle(key: DistillRole) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function submit() {
    if (selected.size === 0) { setError("至少选一个角色"); return; }
    if (limit < 5) { setError("取样至少 5 篇"); return; }
    if (limit > totalInRange) { setError(`超过总文章数 ${totalInRange}`); return; }
    const roles = ROLE_OPTIONS.map((r) => r.key).filter((k) => selected.has(k));
    onSubmit({ roles, limit });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--heading)]">蒸馏 {account}</h2>
        <div className="text-xs text-[var(--meta)] mt-1">vault 里已有 {totalInRange} 篇可用文章</div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-[var(--meta)] font-semibold uppercase tracking-wider">
            风格角色 <span className="text-[var(--red)]">*</span> <span className="text-[var(--faint)] font-normal ml-1">可多选</span>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <button type="button" onClick={() => setSelected(new Set(ROLE_OPTIONS.map((r) => r.key)))} className="text-[var(--accent)] hover:underline">全选</button>
            <span className="text-[var(--faint)]">·</span>
            <button type="button" onClick={() => setSelected(new Set())} className="text-[var(--meta)] hover:text-[var(--heading)]">清空</button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {ROLE_OPTIONS.map((r) => {
            const active = selected.has(r.key);
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => toggle(r.key)}
                className={`text-left rounded border p-3 transition-colors ${
                  active ? "border-[var(--accent)] bg-[var(--accent-fill)]" : "border-[var(--hair)] bg-[var(--bg-1)] hover:border-[var(--accent-soft)]"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${active ? "border-[var(--accent)] bg-[var(--accent)]" : "border-[var(--hair-strong)]"}`}>
                    {active && <span className="text-[var(--accent-on)] text-[10px] font-bold">✓</span>}
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.color }} />
                  <span className="text-sm font-semibold text-[var(--heading)]">{r.label}</span>
                  <span className="text-[10px] text-[var(--faint)] font-mono-term ml-auto">{r.key}</span>
                </div>
                <div className="text-xs text-[var(--meta)] leading-relaxed pl-6">{r.desc}</div>
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-[var(--faint)] mt-2">
          选中几个就蒸馏几个。全选 3 个时会共享切片 pass，比逐个跑快不少。
        </div>
      </section>

      <section>
        <label className="block">
          <span className="text-xs text-[var(--meta)] font-semibold uppercase tracking-wider">取样篇数</span>
          <input
            aria-label="limit"
            type="number"
            min={5}
            max={totalInRange}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="mt-1.5 w-32 h-9 px-3 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
          />
          <span className="ml-3 text-xs text-[var(--faint)]">建议 30-80；太少风格不稳，太多耗时长</span>
        </label>
      </section>

      {error && <div className="text-xs text-[var(--red)]">{error}</div>}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--hair)]">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center h-9 px-4 rounded text-sm text-[var(--meta)] hover:text-[var(--heading)]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={selected.size === 0}
          className="inline-flex items-center h-9 px-4 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-sm text-[var(--accent-on)] font-semibold hover:shadow-[0_0_12px_var(--accent-dim)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          开始蒸馏 {selected.size > 0 && `${selected.size} 个角色`} →
        </button>
      </div>
    </div>
  );
}
