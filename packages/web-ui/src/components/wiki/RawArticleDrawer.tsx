import { useEffect, useMemo, useState } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Dialog, DialogContent, Chip } from "../ui";
import { getRawArticle, type RawArticle } from "../../api/wiki-client";

// body_plain is extracted text with image URLs sitting inline. Promote
// anything that looks like an image URL to a markdown image on its own
// line so ReactMarkdown actually renders it.
function preprocessBody(body: string): string {
  // 1) image URLs — either wx_fmt=png|jpg|… or a direct image extension
  const withImages = body.replace(
    /(https?:\/\/[^\s<>()]+?(?:wx_fmt=(?:png|jpg|jpeg|gif|webp)|\.(?:png|jpg|jpeg|gif|webp))[^\s<>()]*)/gi,
    (url) => `\n\n![](${url})\n\n`,
  );
  // 2) non-image URLs glued directly onto surrounding text: insert a space
  //    so they parse as a link instead of being absorbed into a word
  const withSpacedLinks = withImages.replace(
    /([^\s>])(https?:\/\/)/g,
    "$1 $2",
  );
  return withSpacedLinks;
}

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

  const preparedBody = useMemo(
    () => article ? preprocessBody(article.body_plain) : "",
    [article],
  );

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
        aria-describedby={undefined}
      >
        <div className="flex items-center justify-between px-5 h-12 border-b border-[var(--hair)]">
          <RadixDialog.Title className="text-xs text-[var(--meta)] m-0 font-normal">原文</RadixDialog.Title>
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
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ src, alt }) => (
                      <img
                        src={typeof src === "string" ? src : ""}
                        alt={alt ?? ""}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="rounded border border-[var(--hair)] my-3 max-w-full h-auto"
                      />
                    ),
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noreferrer noopener" className="text-[var(--accent)] hover:underline break-all">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {preparedBody}
                </ReactMarkdown>
              </div>
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
