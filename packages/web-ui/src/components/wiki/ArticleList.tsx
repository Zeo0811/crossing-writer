import { Chip } from "../ui";

export interface ArticleListItem {
  id: string;
  title: string;
  published_at: string;
  ingest_status: string;
  word_count: number | null;
}

export interface ArticleListProps {
  articles: ArticleListItem[];
  duplicates: Set<string>;
  selectedIds: Set<string>;
  onToggle: (articleId: string) => void;
}

export function ArticleList({ articles, duplicates, selectedIds, onToggle }: ArticleListProps) {
  if (articles.length === 0) {
    return <div className="py-8 text-center text-xs text-[var(--faint)]">无文章</div>;
  }
  return (
    <div className="rounded bg-[var(--bg-2)] overflow-hidden">
      {articles.map((a) => {
        const dup = duplicates.has(a.id);
        const selected = selectedIds.has(a.id);
        return (
          <button
            key={a.id}
            type="button"
            data-testid={`article-row-${a.id}`}
            aria-pressed={selected}
            aria-disabled={dup}
            disabled={dup}
            onClick={() => !dup && onToggle(a.id)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs border-b border-[var(--hair)] last:border-b-0 ${
              dup ? "opacity-50 cursor-not-allowed" :
              selected ? "bg-[var(--accent-fill)]" : "hover:bg-[rgba(64,255,159,0.04)]"
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center text-[9px] shrink-0 ${
              selected ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]" : "border-[var(--hair-strong)]"
            }`}>
              {selected && "✓"}
            </span>
            <span className="flex-1 min-w-0 truncate text-[var(--heading)]">{a.title}</span>
            <span className="text-[var(--meta)] shrink-0">{a.published_at}</span>
            {dup && <Chip variant="neutral" size="sm">已入库</Chip>}
            {a.word_count != null && <span className="text-[var(--faint)] shrink-0">{a.word_count}字</span>}
          </button>
        );
      })}
    </div>
  );
}
