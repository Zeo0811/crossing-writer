import { useMock } from "../MockProvider";

export function MockSettings() {
  const m = useMock();
  return (
    <div className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-base text-[var(--heading)] font-semibold">设置</h1>
      </header>
      <main className="p-6 space-y-4 max-w-[680px]">
        <Group title="外观">
          <Row label="主题">
            <div className="flex items-center gap-1 p-1 rounded border border-[var(--hair)]">
              {(["dark", "light"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => m.setTheme(t)}
                  className={`px-3 py-1 text-xs rounded ${m.theme === t ? "bg-[var(--accent-fill)] text-[var(--accent)]" : "text-[var(--meta)] hover:text-[var(--heading)]"}`}
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
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              ready · claude-opus-4-6
            </span>
          </Row>
          <Row label="codex">
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              ready · gpt-5-thinking
            </span>
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
            <button className="px-3 py-1 text-xs rounded border border-[var(--hair-strong)] text-[var(--meta)] hover:text-[var(--heading)]">绑定</button>
          </Row>
        </Group>
        <Group title="关于">
          <Row label="版本"><span className="text-xs text-[var(--meta)]">v1.5.0 · build 2026-04-15</span></Row>
          <Row label="更新日志"><button className="text-xs text-[var(--accent)] hover:underline">查看</button></Row>
        </Group>
      </main>
    </div>
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
