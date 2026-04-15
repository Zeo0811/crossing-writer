import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useMock } from "../MockProvider";
import { ThemeToggle } from "./ThemeToggle";
import {
  IconProjects, IconKnowledge, IconStyle, IconConfig, IconSettings, IconCrossing,
} from "./PixelIcons";

const NAV_ITEMS = [
  { to: "/mock", label: "项目", icon: IconProjects, end: true },
  { to: "/mock/knowledge", label: "知识库", icon: IconKnowledge },
  { to: "/mock/style-panels", label: "风格", icon: IconStyle },
  { to: "/mock/config", label: "配置", icon: IconConfig },
  { to: "/mock/settings", label: "设置", icon: IconSettings },
];

interface CliInfo {
  name: string;
  status: "ready" | "starting" | "down";
  version?: string;
  model?: string;
  lastCheck?: string;
  binPath?: string;
  errorMsg?: string;
  startCmd?: string;
}

function CliChip({ info, onRestart }: { info: CliInfo; onRestart?: () => void }) {
  const { name, status } = info;
  const [hover, setHover] = useState(false);
  const isReady = status === "ready";
  const isStarting = status === "starting";
  const color = isReady ? "var(--accent)" : isStarting ? "var(--amber)" : "var(--red)";
  const label = isReady ? `${name}_ready` : isStarting ? `${name}_starting` : `${name}_down`;
  return (
    <span
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border border-[var(--hair)] bg-[var(--bg-1)] text-[11px] text-[var(--meta)] cursor-default">
        <span
          className={`w-1.5 h-1.5 rounded-full ${isStarting ? "animate-pulse" : ""}`}
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
          <Row k="model" v={info.model ?? "—"} />
          <Row k="version" v={info.version ?? "—"} />
          <Row k="bin" v={info.binPath ?? "—"} mono />
          <Row k="last check" v={info.lastCheck ?? "—"} />
          {info.errorMsg && (
            <div className="mt-2 px-2 py-1.5 rounded-sm bg-[rgba(255,107,107,0.1)] border border-[var(--red)] text-[11px] text-[var(--red)]">
              {info.errorMsg}
            </div>
          )}
          {!isReady && info.startCmd && (
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wider text-[var(--faint)] mb-1">在终端运行</div>
              <div className="flex items-center gap-1 px-2 py-1.5 rounded-sm bg-[var(--log-bg)] border border-[var(--hair)]">
                <span className="text-[var(--accent)] text-[11px]" style={{ fontFamily: "var(--font-mono)" }}>$</span>
                <code
                  className="flex-1 text-[11px] text-[var(--body)] truncate"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {info.startCmd}
                </code>
                <button
                  onClick={() => { navigator.clipboard?.writeText(info.startCmd!); }}
                  title="复制"
                  className="text-[var(--meta)] hover:text-[var(--accent)] text-[10px] px-1"
                >
                  ⎘
                </button>
              </div>
            </div>
          )}
          {!isReady && onRestart && (
            <button
              onClick={onRestart}
              className="mt-2 w-full px-2 py-1 text-[11px] rounded border border-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent-fill)]"
            >
              {isStarting ? "正在启动…" : "尝试自动重启"}
            </button>
          )}
        </div>
      )}
    </span>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--faint)]">{k}</span>
      <span
        className="text-[var(--body)] truncate text-right"
        style={mono ? { fontFamily: "var(--font-mono)" } : undefined}
      >
        {v}
      </span>
    </div>
  );
}

export function TopBar() {
  const m = useMock();
  // map global cliHealth to two CLI states for demo
  const claudeStatus: "ready" | "starting" | "down" =
    m.cliHealth === "ok" ? "ready" : m.cliHealth === "slow" ? "starting" : "down";
  const codexStatus: "ready" | "starting" | "down" =
    m.cliHealth === "ok" ? "ready" : m.cliHealth === "slow" ? "ready" : "down";

  return (
    <header className="flex items-center gap-6 rounded border border-[var(--hair)] bg-[var(--bg-1)] py-3 px-[18px]">
      <div className="flex items-center gap-3">
        <NavLink to="/mock" className="flex items-baseline gap-2 group">
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
          className="w-3 h-3 inline-block ml-1"
          style={{
            background:
              "linear-gradient(180deg, var(--pink) 0 60%, color-mix(in srgb, var(--pink) 70%, #000) 60% 100%)",
            boxShadow: "0 0 0 1px var(--pink-shadow)",
          }}
          aria-hidden
        />
      </div>

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
        <CliChip
          info={{
            name: "claude",
            status: claudeStatus,
            version: "1.0.118",
            model: "claude-opus-4-6",
            binPath: "/Users/zeoooo/.local/bin/claude",
            lastCheck: claudeStatus === "ready" ? "12 秒前" : "1 分钟前",
            errorMsg: claudeStatus === "down" ? "process exited (signal=SIGTERM)" : undefined,
            startCmd: claudeStatus !== "ready" ? "claude --dangerously-skip-permissions" : undefined,
          }}
          onRestart={() => m.pushToast({ type: "info", message: "正在重启 claude…" })}
        />
        <CliChip
          info={{
            name: "codex",
            status: codexStatus,
            version: "0.39.0",
            model: "gpt-5-mini",
            binPath: "/Users/zeoooo/.local/bin/codex",
            lastCheck: codexStatus === "ready" ? "8 秒前" : "刚刚",
            errorMsg: codexStatus === "down" ? "ENOENT: command not found" : undefined,
            startCmd: codexStatus !== "ready" ? "codex login && codex --version" : undefined,
          }}
          onRestart={() => m.pushToast({ type: "info", message: "正在重启 codex…" })}
        />
        <ThemeToggle />
      </div>
    </header>
  );
}
