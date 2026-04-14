import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { getPage } from "../../api/wiki-client";

export interface WikiPagePreviewProps { path: string | null }

export function WikiPagePreview({ path }: WikiPagePreviewProps) {
  const [text, setText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) { setText(""); setError(null); return; }
    let cancelled = false;
    setError(null);
    getPage(path)
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [path]);

  if (!path) return <div className="p-6 text-gray-500">Select a page from the left.</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;

  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");

  return (
    <div className="p-4 overflow-auto h-full prose prose-sm max-w-none">
      <ReactMarkdown>{body}</ReactMarkdown>
    </div>
  );
}
