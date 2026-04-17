import { TopicExpertPanel } from '../components/config/TopicExpertPanel.js';

export function TopicExpertsPage() {
  return (
    <div
      data-testid="page-topic-experts"
      className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden"
    >
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-lg font-semibold text-[var(--heading)]">选题专家</h1>
      </header>
      <div className="p-6">
        <TopicExpertPanel />
      </div>
    </div>
  );
}
