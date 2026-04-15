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
    setConfig({
      ...config,
      agents: { ...config.agents, [key]: { cli: "claude" } },
    });
  }

  async function save() {
    if (!config) throw new Error("config not loaded");
    await patchAgentsConfig(config);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex" data-modal-root="" data-testid="settings-drawer">
      <div className="flex-1 bg-[rgba(0,0,0,0.55)] backdrop-blur-[6px]" onClick={onClose} />
      <aside className="w-96 bg-bg-1 border-l border-hair text-body shadow-xl overflow-y-auto p-4 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="font-semibold text-heading m-0">设置 · Agent / CLI</h2>
          <button type="button" onClick={onClose} className="text-xl text-meta hover:text-accent bg-transparent border-0 cursor-pointer">×</button>
        </header>

        {loadError && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-300 rounded p-2">
            加载失败：{loadError}
          </div>
        )}

        {config && (
          <>
            <section>
              <label className="block text-xs mb-1">默认 CLI</label>
              <select
                className="w-full border p-1"
                value={config.defaultCli}
                onChange={(e) => setConfig({ ...config, defaultCli: e.target.value as any })}
              >
                <option value="claude">claude</option>
                <option value="codex">codex</option>
              </select>
            </section>

            <section>
              <label className="block text-xs mb-1">Fallback CLI</label>
              <select
                className="w-full border p-1"
                value={config.fallbackCli}
                onChange={(e) => setConfig({ ...config, fallbackCli: e.target.value as any })}
              >
                <option value="claude">claude</option>
                <option value="codex">codex</option>
              </select>
            </section>

            <section>
              <h3 className="text-xs font-semibold mb-1">Agents</h3>
              <ul className="space-y-2">
                {Object.entries(config.agents).map(([k, v]) => (
                  <li key={k} className="flex gap-1 items-center">
                    <span className="w-44 text-xs font-mono truncate" title={k}>{k}</span>
                    <select
                      className="border p-1 text-xs"
                      value={v.cli}
                      onChange={(e) => updateAgent(k, { cli: e.target.value as any })}
                    >
                      <option value="claude">claude</option>
                      <option value="codex">codex</option>
                    </select>
                    <input
                      className="flex-1 border p-1 text-xs"
                      placeholder="model（空=默认）"
                      value={v.model ?? ""}
                      onChange={(e) => updateAgent(k, { model: e.target.value })}
                    />
                    <button
                      onClick={() => removeAgent(k)}
                      className="text-xs text-red-600"
                      aria-label={`remove ${k}`}
                    >
                      删
                    </button>
                  </li>
                ))}
              </ul>
              <button onClick={addAgent} className="mt-2 text-xs text-blue-600">
                + 添加 agent
              </button>
            </section>

            <footer className="pt-4 border-t flex gap-2">
              <ActionButton
                onClick={save}
                successMsg="保存成功"
                errorMsg={(e) => `保存失败：${String(e)}`}
              >
                保存
              </ActionButton>
              <button onClick={onClose} className="px-3 py-1 border rounded">
                取消
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
