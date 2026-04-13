import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export async function fetchUrlToMarkdown(url: string, opts?: { timeoutMs?: number }): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 CrossingWriter" },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`fetch failed status=${res.status}`);
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article || !article.textContent) return "";
  const title = article.title ? `# ${article.title}\n\n` : "";
  return `${title}${article.textContent.trim()}`;
}
