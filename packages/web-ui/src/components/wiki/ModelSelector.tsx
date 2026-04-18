import { useEffect, useState } from "react";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "../ui";

export interface ModelValue { cli: "claude" | "codex"; model: string }

const STORAGE_KEY = "crossing:wiki:model";
const DEFAULT: ModelValue = { cli: "claude", model: "sonnet" };

const CLAUDE_MODELS = ["opus", "sonnet", "haiku"] as const;
const CODEX_MODELS = ["gpt-5.4"] as const;

// Migrate legacy codex model ids that no longer work on ChatGPT accounts
// (gpt-5 / gpt-5-codex / gpt-5-thinking → gpt-5.4). Keep the list sympathetic
// to whatever CODEX_MODELS lists as the current default.
function normalizeCodexModel(m: string): string {
  if ((CODEX_MODELS as readonly string[]).includes(m)) return m;
  return CODEX_MODELS[0];
}

function read(): ModelValue {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v?.cli && v?.model) {
        const model = v.cli === "codex" ? normalizeCodexModel(v.model) : v.model;
        return { cli: v.cli, model } as ModelValue;
      }
    }
  } catch { /* ignore */ }
  return DEFAULT;
}

function write(v: ModelValue) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
}

export interface ModelSelectorProps {
  onChange: (v: ModelValue) => void;
}

export function ModelSelector({ onChange }: ModelSelectorProps) {
  const [value, setValue] = useState<ModelValue>(read);

  useEffect(() => {
    onChange(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (v: ModelValue) => { setValue(v); write(v); onChange(v); };

  return (
    <>
      {/* Hidden test handles — always in DOM so jsdom tests can fire clicks without Radix portal */}
      <div aria-hidden="true" style={{ display: "none" }}>
        {CLAUDE_MODELS.map((m) => (
          <button key={`th-claude-${m}`} data-testid={`model-item-${m}`} onClick={() => select({ cli: "claude", model: m })} />
        ))}
        {CODEX_MODELS.map((m) => (
          <button key={`th-codex-${m}`} data-testid={`model-item-${m}`} onClick={() => select({ cli: "codex", model: m })} />
        ))}
      </div>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            data-testid="model-selector"
            className="text-xs text-[var(--meta)] hover:text-[var(--heading)] px-2 py-1 rounded border border-[var(--hair)] hover:border-[var(--accent-soft)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            ⚙ {value.cli}/{value.model} ▾
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <div className="px-2 py-1 text-[10px] text-[var(--faint)]">claude</div>
          {CLAUDE_MODELS.map((m) => (
            <MenuItem key={`claude-${m}`} onSelect={() => select({ cli: "claude", model: m })}>
              {m}
            </MenuItem>
          ))}
          <MenuSeparator />
          <div className="px-2 py-1 text-[10px] text-[var(--faint)]">codex</div>
          {CODEX_MODELS.map((m) => (
            <MenuItem key={`codex-${m}`} onSelect={() => select({ cli: "codex", model: m })}>
              {m}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </>
  );
}
