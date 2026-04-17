import type { WikiFrontmatter } from "../../api/wiki-client";
import { Chip } from "../ui";

export interface WikiFrontmatterFooterProps {
  frontmatter: WikiFrontmatter;
  onNavigate: (path: string) => void;
  onOpenSource: (account: string, articleId: string) => void;
  knownPaths: Set<string>;
}

export function WikiFrontmatterFooter({
  frontmatter,
  onNavigate,
  onOpenSource,
  knownPaths,
}: WikiFrontmatterFooterProps) {
  const sources = frontmatter.sources ?? [];
  const backlinks = frontmatter.backlinks ?? [];
  const images = frontmatter.images ?? [];

  if (sources.length === 0 && backlinks.length === 0 && images.length === 0) return null;

  return (
    <div className="mt-6 space-y-5">
      {sources.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--meta)] mb-2">
            Sources（{sources.length}）
          </h3>
          <div className="space-y-1.5">
            {sources.map((s, i) => (
              <button
                key={`${s.article_id}-${i}`}
                type="button"
                onClick={() => onOpenSource(s.account, s.article_id)}
                aria-label={`${s.account} ${s.article_id.slice(0, 8)}`}
                className="w-full flex items-start gap-2 px-3 py-2 rounded bg-[var(--bg-2)] hover:bg-[var(--accent-fill)] text-left"
              >
                <Chip variant="neutral" tone="soft" size="sm">{s.account}</Chip>
                <span className="text-[10px] text-[var(--faint)] font-mono mt-0.5">
                  {s.article_id.slice(0, 8)}
                </span>
                <span className="flex-1 text-xs text-[var(--body)] italic">
                  "{s.quoted}"
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {backlinks.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--meta)] mb-2">
            Backlinks（{backlinks.length}）
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {backlinks.map((p) => {
              const known = knownPaths.has(p);
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!known}
                  title={known ? undefined : "页面已不存在"}
                  onClick={() => known && onNavigate(p)}
                  className={`px-2 py-1 rounded text-xs border ${
                    known
                      ? "border-[var(--hair)] bg-[var(--bg-2)] text-[var(--body)] hover:border-[var(--accent-soft)] hover:text-[var(--accent)]"
                      : "border-[var(--hair)] bg-[var(--bg-2)] text-[var(--faint)] cursor-not-allowed opacity-60"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {images.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--meta)] mb-2">
            Images（{images.length}）
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {images.map((im, i) => (
              <a
                key={`${im.url}-${i}`}
                href={im.url}
                target="_blank"
                rel="noreferrer noopener"
                title={im.caption ?? ""}
                className="block"
              >
                <img
                  src={im.url}
                  alt={im.caption ?? `image-${i}`}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className="w-full h-16 object-cover rounded bg-[var(--bg-2)]"
                />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
