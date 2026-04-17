import { useEffect, useState } from "react";
import { Dialog, DialogContent, Chip } from "../ui";
import { getRawArticle, type RawArticle } from "../../api/wiki-client";

export interface RawArticleDrawerProps {
  open: boolean;
  account: string | null;
  articleId: string | null;
  onClose: () => void;
}

export function RawArticleDrawer({ open, account, articleId, onClose }: RawArticleDrawerProps) {
  const [article, setArticle] = useState<RawArticle | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !account || !articleId) return;
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    setArticle(null);
    getRawArticle(account, articleId)
      .then((a) => { if (!cancelled) setArticle(a); })
      .catch(() => { if (!cancelled) setMissing(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, account, articleId]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="!left-auto !top-0 !right-0 !translate-x-0 !translate-y-0 !max-h-screen !h-screen !rounded-none border-l border-[var(--hair-strong)]"
        width="40vw"
        aria-label="原文抽屉"
      >
        <div className="flex items-center justify-between px-5 h-12 border-b border-[var(--hair)]">
          <span className="text-xs text-[var(--meta)]">原文</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="w-7 h-7 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          {loading && <div className="text-sm text-[var(--meta)]">加载中…</div>}
          {!loading && missing && <div className="text-sm text-[var(--faint)]">原文档案已清理</div>}
          {!loading && article && (
            <article className="space-y-3">
              <header className="space-y-2">
                <Chip variant="neutral" size="sm">{article.account}</Chip>
                <h2 className="text-base font-semibold text-[var(--heading)]">{article.title}</h2>
                <div className="text-xs text-[var(--faint)]">
                  {article.published_at}
                  {article.author && <> · {article.author}</>}
                  {article.word_count != null && <> · {article.word_count} 字</>}
                </div>
              </header>
              <pre className="whitespace-pre-wrap text-sm text-[var(--body)] font-sans leading-relaxed">{article.body_plain}</pre>
              {article.url && (
                <a
                  href={article.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                >
                  打开原 URL ↗
                </a>
              )}
            </article>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
