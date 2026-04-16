import { useTheme } from "../hooks/useTheme";
import { useCliHealth } from "../hooks/useCliHealth";
import { Button } from "../components/ui";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { data: health } = useCliHealth();
  return (
    <div className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-lg text-[var(--heading)] font-semibold">设置</h1>
      </header>
      <main className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Group title="外观">
          <Row label="主题">
            <div className="flex items-center gap-1 p-1 rounded border border-[var(--hair)]">
              {(["dark", "light"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`px-3 py-1 text-xs rounded ${theme === t ? "bg-[var(--accent-fill)] text-[var(--accent)]" : "text-[var(--meta)] hover:text-[var(--heading)]"}`}
                >
                  {t === "dark" ? "深色" : "浅色"}
                </button>
              ))}
            </div>
          </Row>
        </Group>
        <Group title="工作目录">
          <Row label="Vault 路径">
            <code className="text-xs text-[var(--body)]" style={{ fontFamily: "var(--font-mono)" }}>~/.crossing/vault</code>
          </Row>
          <Row label="Projects 目录">
            <code className="text-xs text-[var(--body)]" style={{ fontFamily: "var(--font-mono)" }}>~/.crossing/projects</code>
          </Row>
        </Group>
        <Group title="CLI">
          <Row label="claude">
            <CliStatus status={health?.claude?.status} version={health?.claude?.version} />
          </Row>
          <Row label="codex">
            <CliStatus status={health?.codex?.status} version={health?.codex?.version} />
          </Row>
          <Row label="默认 CLI">
            <select className="bg-[var(--bg-2)] border border-[var(--hair)] rounded px-2 py-1 text-xs text-[var(--body)]">
              <option>claude</option>
              <option>codex</option>
            </select>
          </Row>
        </Group>
        <Group title="发布">
          <Row label="微信公众号">
            <Button variant="secondary" size="sm">绑定</Button>
          </Row>
        </Group>
        <Group title="关于">
          <Row label="版本"><span className="text-xs text-[var(--meta)]">v1.6.0</span></Row>
          <Row label="更新日志"><Button variant="link" size="sm">查看</Button></Row>
        </Group>
      </main>
    </div>
  );
}

function CliStatus({ status, version }: { status?: string; version?: string }) {
  const ok = status === "online";
  const color = ok ? "var(--accent)" : "var(--red)";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      <span style={{ fontFamily: "var(--font-mono)" }}>{status ?? "unknown"}</span>
      {version && <span className="text-[var(--faint)]">· {version}</span>}
    </span>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded bg-[var(--bg-2)] p-4">
      <div className="text-xs text-[var(--meta)] font-semibold mb-3">{title}</div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-[var(--body)]">{label}</span>
      {children}
    </div>
  );
}
