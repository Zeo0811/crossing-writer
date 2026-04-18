import { useEffect, useState } from "react";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "../ui";

export interface ModelValue { cli: "claude" | "codex"; model: string }

const STORAGE_KEY = "crossing:wiki:model";
const DEFAULT: ModelValue = { cli: "claude", model: "claude-sonnet-4-5" };

// id is what we hand to the CLI (--model), label is what we show in the UI.
// Claude CLI does NOT accept short forms with a version (e.g. `opus-4.7`),
// only bare aliases (`opus`) or full ids (`claude-opus-4-7`). So we store the
// full id and display a compact label.
interface ModelOption { id: string; label: string }
const CLAUDE_MODELS: readonly ModelOption[] = [
  { id: "claude-opus-4-7",   label: "opus-4.7" },
  { id: "claude-sonnet-4-5", label: "sonnet-4.5" },
  { id: "claude-haiku-4-5",  label: "haiku-4.5" },
];
const CODEX_MODELS: readonly ModelOption[] = [
  { id: "gpt-5.4", label: "gpt-5.4" },
];

function findLabel(cli: "claude" | "codex", id: string): string {
  const list = cli === "claude" ? CLAUDE_MODELS : CODEX_MODELS;
  return list.find((m) => m.id === id)?.label ?? id;
}

// Normalize legacy model ids that were stored before we switched to full
// version-suffixed ids:
//   claude: opus/sonnet/haiku (bare aliases) → claude-opus-4-7 etc.
//   codex:  gpt-5 / gpt-5-codex / gpt-5-thinking → gpt-5.4
function normalizeModel(cli: "claude" | "codex", m: string): string {
  const list = cli === "claude" ? CLAUDE_MODELS : CODEX_MODELS;
  if (list.some((o) => o.id === m)) return m;
  if (cli === "claude") {
    const bare = m.split("-")[0]; // "opus" / "sonnet" / "haiku"
    const match = list.find((o) => o.id.includes(`-${bare}-`));
    if (match) return match.id;
  }
  return list[0]!.id;
}

function read(): ModelValue {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v?.cli && v?.model) {
        const cli = v.cli as "claude" | "codex";
        return { cli, model: normalizeModel(cli, v.model) };
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
          <button key={`th-claude-${m.id}`} data-testid={`model-item-${m.label}`} onClick={() => select({ cli: "claude", model: m.id })} />
        ))}
        {CODEX_MODELS.map((m) => (
          <button key={`th-codex-${m.id}`} data-testid={`model-item-${m.label}`} onClick={() => select({ cli: "codex", model: m.id })} />
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
            ⚙ {value.cli}/{findLabel(value.cli, value.model)} ▾
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <div className="px-2 py-1 text-[10px] text-[var(--faint)]">claude</div>
          {CLAUDE_MODELS.map((m) => (
            <MenuItem key={`claude-${m.id}`} onSelect={() => select({ cli: "claude", model: m.id })}>
              {m.label}
            </MenuItem>
          ))}
          <MenuSeparator />
          <div className="px-2 py-1 text-[10px] text-[var(--faint)]">codex</div>
          {CODEX_MODELS.map((m) => (
            <MenuItem key={`codex-${m.id}`} onSelect={() => select({ cli: "codex", model: m.id })}>
              {m.label}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </>
  );
}
