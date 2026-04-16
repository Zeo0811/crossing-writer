import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useTheme } from "../../hooks/useTheme";
import { useCliHealth } from "../../hooks/useCliHealth";
import { IconProjects, IconKnowledge, IconStyle, IconConfig, IconSettings } from "./PixelIcons";

const NAV_ITEMS = [
  { to: "/", label: "项目", icon: IconProjects, end: true },
  { to: "/knowledge", label: "知识库", icon: IconKnowledge },
  { to: "/style-panels", label: "风格", icon: IconStyle },
  { to: "/writing-hard-rules", label: "硬规则", icon: IconConfig },
  { to: "/config", label: "配置", icon: IconConfig },
  { to: "/settings", label: "设置", icon: IconSettings },
];

export function TopBar() {
  const { theme, toggle } = useTheme();
  const { data: health } = useCliHealth();

  const claudeStatus: "ready" | "down" = health?.claude?.status === "online" ? "ready" : "down";
  const codexStatus: "ready" | "down" = health?.codex?.status === "online" ? "ready" : "down";

  return (
    <header className="flex items-center gap-6 rounded border border-[var(--hair)] bg-[var(--bg-1)] py-3 px-[18px]">
      <NavLink to="/" className="flex items-baseline gap-2 group">
        <span
          className="text-[14px] tracking-[1.5px] text-[var(--accent)] group-hover:drop-shadow-[0_0_8px_var(--accent)] transition-all"
          style={{ fontFamily: "var(--font-pixel)" }}
        >
          CROSSING.WRITER
        </span>
        <span
          className="text-[10px] text-[var(--accent-dim)]"
          style={{ fontFamily: "var(--font-pixel)" }}
        >
          v1.5
        </span>
      </NavLink>
      <span
        className="w-3 h-3 inline-block"
        style={{
          background:
            "linear-gradient(180deg, var(--pink) 0 60%, color-mix(in srgb, var(--pink) 70%, #000) 60% 100%)",
          boxShadow: "0 0 0 1px var(--pink-shadow)",
        }}
        aria-hidden
      />
      <nav className="flex items-center gap-5 text-[13px]">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `relative py-1 flex items-center gap-1.5 transition-colors ${isActive ? "text-[var(--heading)]" : "text-[var(--meta)] hover:text-[var(--heading)]"}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={12} />
                  <span>{item.label}</span>
                  {isActive && (
                    <span className="absolute -bottom-1 left-0 right-0 h-[2px] rounded-sm bg-[var(--accent)]" />
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <CliChip name="claude" status={claudeStatus} version={health?.claude?.version} />
        <CliChip name="codex" status={codexStatus} version={health?.codex?.version} />
        <button
          onClick={toggle}
          title={theme === "dark" ? "切到亮色" : "切到深色"}
          aria-label="Toggle theme"
          className="w-8 h-8 rounded border border-[var(--hair)] bg-[var(--bg-1)] hover:border-[var(--accent)] hover:text-[var(--accent)] flex items-center justify-center text-[var(--meta)] transition-colors"
        >
          <span className="text-sm" aria-hidden>{theme === "dark" ? "☾" : "☀"}</span>
        </button>
      </div>
    </header>
  );
}

function CliChip({
  name, status, version,
}: { name: string; status: "ready" | "down"; version?: string }) {
  const [hover, setHover] = useState(false);
  const isReady = status === "ready";
  const color = isReady ? "var(--accent)" : "var(--red)";
  const label = `${name}_${status}`;
  return (
    <span className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-[11px] text-[var(--meta)] cursor-default">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: color, boxShadow: isReady ? `0 0 6px ${color}` : "none" }}
        />
        <span style={{ fontFamily: "var(--font-mono)" }}>{label}</span>
      </span>
      {hover && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[260px] rounded border border-[var(--hair-strong)] bg-[var(--bg-1)] shadow-[0_8px_24px_rgba(0,0,0,0.35)] p-3 text-[12px] text-[var(--body)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[var(--heading)] font-semibold" style={{ fontFamily: "var(--font-mono)" }}>{name}</span>
            <span className="inline-flex items-center gap-1.5 text-[10px]" style={{ color }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
              {status.toUpperCase()}
            </span>
          </div>
          <Row k="version" v={version ?? "—"} />
          {!isReady && (
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wider text-[var(--faint)] mb-1">在终端运行</div>
              <div className="flex items-center gap-1 px-2 py-1.5 rounded-sm bg-[var(--log-bg)] border border-[var(--hair)]">
                <span className="text-[var(--accent)] text-[11px]" style={{ fontFamily: "var(--font-mono)" }}>$</span>
                <code className="flex-1 text-[11px] text-[var(--body)] truncate" style={{ fontFamily: "var(--font-mono)" }}>
                  {name === "claude" ? "claude --dangerously-skip-permissions" : "codex login"}
                </code>
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--faint)]">{k}</span>
      <span className="text-[var(--body)] truncate text-right">{v}</span>
    </div>
  );
}
