import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { getPageMeta, type WikiPageFull } from "../../api/wiki-client";
import { WikiFrontmatterFooter } from "./WikiFrontmatterFooter";
import { useWikiIndex } from "../../hooks/useWikiIndex";
import { splitByIndex, type IndexEntry } from "./autoLink";

export interface WikiPagePreviewProps {
  path: string | null;
  onNavigate: (path: string) => void;
  onOpenSource: (account: string, articleId: string) => void;
}

function AutoLinkText({
  text, index, currentPath, onNavigate,
}: { text: string; index: IndexEntry[]; currentPath: string; onNavigate: (p: string) => void }) {
  const segs = useMemo(() => splitByIndex(text, index, currentPath), [text, index, currentPath]);
  return (
    <>
      {segs.map((s, i) =>
        s.kind === "text"
          ? <span key={i}>{s.text}</span>
          : (
            <button
              key={i}
              type="button"
              onClick={() => onNavigate(s.path)}
              className="text-[var(--accent)] hover:underline px-0 py-0 bg-transparent border-0 cursor-pointer"
            >
              {s.text}
            </button>
          ),
      )}
    </>
  );
}

export function WikiPagePreview({ path, onNavigate, onOpenSource }: WikiPagePreviewProps) {
  const [page, setPage] = useState<WikiPageFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { entries: indexEntries } = useWikiIndex();

  useEffect(() => {
    if (!path) { setPage(null); setError(null); return; }
    let cancelled = false;
    setError(null);
    getPageMeta(path)
      .then((p) => { if (!cancelled) setPage(p); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [path]);

  const knownPaths = useMemo(() => new Set(indexEntries.map((e) => e.path)), [indexEntries]);

  if (!path) return <div className="p-6 text-[var(--meta)]">Select a page from the left.</div>;
  if (error) return <div className="p-6 text-[var(--red)]">Error: {error}</div>;
  if (!page) return <div className="p-6 text-[var(--meta)]">加载中…</div>;

  const currentPath = path;

  return (
    <div className="p-4 overflow-auto h-full prose prose-sm max-w-none">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p>{autoLinkChildren(children, indexEntries, currentPath, onNavigate)}</p>,
          li: ({ children }) => <li>{autoLinkChildren(children, indexEntries, currentPath, onNavigate)}</li>,
          h1: ({ children }) => <h1>{autoLinkChildren(children, indexEntries, currentPath, onNavigate)}</h1>,
          h2: ({ children }) => <h2>{autoLinkChildren(children, indexEntries, currentPath, onNavigate)}</h2>,
          h3: ({ children }) => <h3>{autoLinkChildren(children, indexEntries, currentPath, onNavigate)}</h3>,
        }}
      >
        {page.body}
      </ReactMarkdown>
      <WikiFrontmatterFooter
        frontmatter={page.frontmatter}
        onNavigate={onNavigate}
        onOpenSource={onOpenSource}
        knownPaths={knownPaths}
      />
    </div>
  );
}

function autoLinkChildren(
  children: React.ReactNode,
  index: IndexEntry[],
  currentPath: string,
  onNavigate: (p: string) => void,
): React.ReactNode {
  if (typeof children === "string") {
    return <AutoLinkText text={children} index={index} currentPath={currentPath} onNavigate={onNavigate} />;
  }
  if (Array.isArray(children)) {
    return children.map((c, i) =>
      typeof c === "string"
        ? <AutoLinkText key={i} text={c} index={index} currentPath={currentPath} onNavigate={onNavigate} />
        : c,
    );
  }
  return children;
}
