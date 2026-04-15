import { useEffect, useState } from "react";
import { getAgentsConfig, patchAgentsConfig, type AgentsConfig } from "../../api/config-client";
import { ActionButton } from "../ui/ActionButton";

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [config, setConfig] = useState<AgentsConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoadError(null);
    getAgentsConfig()
      .then(setConfig)
      .catch((e) => setLoadError(String(e)));
  }, [open]);

  if (!open) return null;

  function updateAgent(key: string, patch: Partial<{ cli: "claude" | "codex"; model: string }>) {
    if (!config) return;
    setConfig({
      ...config,
      agents: { ...config.agents, [key]: { ...config.agents[key], ...patch } as any },
    });
  }

  function removeAgent(key: string) {
    if (!config) return;
    const { [key]: _removed, ...rest } = config.agents;
    setConfig({ ...config, agents: rest });
  }

  function addAgent() {
    if (!config) return;
    const key = prompt("agent key（如 case_expert.X）");
    if (!key) return;
    setConfig({ ...config, agents: { ...config.agents, [key]: { cli: "claude" } } });
  }

  async function save() {
    if (!config) throw new Error("config not loaded");
    await patchAgentsConfig(config);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex" data-modal-root="" data-testid="settings-drawer">
      <div className="flex-1 bg-[rgba(0,0,0,0.55)] backdrop-blur-[6px]" onClick={onClose} />
      <aside className="w-[360px] bg-[var(--bg-1)] border-l border-[var(--hair)] text-[var(--body)] shadow-xl overflow-y-auto flex flex-col">
        <header className="flex items-center justify-between px-4 h-12 border-b border-[var(--hair)]">
          <h2 className="text-sm text-[var(--heading)] font-semibold m-0">Agent / CLI 配置</h2>
          <button type="button" onClick={onClose} className="text-[var(--meta)] hover:text-[var(--heading)]">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loadError && (
            <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] px-3 py-2 text-xs text-[var(--red)]">
              加载失败：{loadError}
            </div>
          )}

          {config && (
            <>
              <section className="rounded bg-[var(--bg-2)] p-3 space-y-2.5">
                <Field label="默认 CLI">
                  <select
                    className="w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded px-2 py-1 text-xs outline-none focus:border-[var(--accent-soft)]"
                    value={config.defaultCli}
                    onChange={(e) => setConfig({ ...config, defaultCli: e.target.value as any })}
                  >
                    <option value="claude">claude</option>
                    <option value="codex">codex</option>
                  </select>
                </Field>
                <Field label="Fallback CLI">
                  <select
                    className="w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded px-2 py-1 text-xs outline-none focus:border-[var(--accent-soft)]"
                    value={config.fallbackCli}
                    onChange={(e) => setConfig({ ...config, fallbackCli: e.target.value as any })}
                  >
                    <option value="claude">claude</option>
                    <option value="codex">codex</option>
                  </select>
                </Field>
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-[var(--meta)] font-semibold">Agents ({Object.keys(config.agents).length})</div>
                  <button onClick={addAgent} className="text-xs text-[var(--accent)] hover:underline">＋ 添加</button>
                </div>
                <ul className="space-y-1.5">
                  {Object.entries(config.agents).map(([k, v]) => (
                    <li key={k} className="flex gap-1.5 items-center px-2 py-1.5 rounded bg-[var(--bg-2)]">
                      <span
                        className="w-36 text-[11px] text-[var(--body)] truncate"
                        style={{ fontFamily: "var(--font-mono)" }}
                        title={k}
                      >
                        {k}
                      </span>
                      <select
                        className="bg-[var(--bg-1)] border border-[var(--hair)] rounded px-1.5 py-0.5 text-[11px] outline-none focus:border-[var(--accent-soft)]"
                        value={v.cli}
                        onChange={(e) => updateAgent(k, { cli: e.target.value as any })}
                      >
                        <option value="claude">claude</option>
                        <option value="codex">codex</option>
                      </select>
                      <input
                        className="flex-1 min-w-0 bg-[var(--bg-1)] border border-[var(--hair)] rounded px-2 py-0.5 text-[11px] outline-none focus:border-[var(--accent-soft)]"
                        style={{ fontFamily: "var(--font-mono)" }}
                        placeholder="model"
                        value={v.model ?? ""}
                        onChange={(e) => updateAgent(k, { model: e.target.value })}
                      />
                      <button
                        onClick={() => removeAgent(k)}
                        className="text-[var(--meta)] hover:text-[var(--red)]"
                        aria-label={`remove ${k}`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>

        {config && (
          <footer className="px-4 py-3 border-t border-[var(--hair)] flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--meta)] hover:text-[var(--heading)]">
              取消
            </button>
            <ActionButton
              onClick={save}
              successMsg="已保存"
              errorMsg={(e) => `保存失败：${String(e)}`}
            >
              保存
            </ActionButton>
          </footer>
        )}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--meta)] block mb-1">{label}</span>
      {children}
    </label>
  );
}
