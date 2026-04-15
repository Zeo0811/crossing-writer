import { useMock } from "../MockProvider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useMock();
  const isDark = theme === "dark";
  return (
    <button
      onClick={toggleTheme}
      title={isDark ? "切到亮色" : "切到深色"}
      className="w-8 h-8 rounded border border-[var(--hair)] bg-[var(--bg-1)] hover:border-[var(--accent)] hover:text-[var(--accent)] flex items-center justify-center text-[var(--meta)] transition-colors"
    >
      <span className="text-sm" aria-hidden>{isDark ? "☾" : "☀"}</span>
    </button>
  );
}
