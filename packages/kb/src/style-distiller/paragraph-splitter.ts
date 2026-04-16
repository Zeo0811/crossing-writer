/**
 * Split an article body into paragraphs using pure heuristics (no LLM).
 * Rules:
 *   1. Blank lines are paragraph separators.
 *   2. Lines starting with `#{1,6} ` become their own paragraph.
 *   3. Lines containing only a markdown image `![...](...)` are compressed to `[图]`.
 */
export function splitParagraphs(body: string): string[] {
  const normalized = body.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const parts: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    if (buf.length > 0) {
      const joined = buf.join('\n').trim();
      if (joined) parts.push(joined);
      buf = [];
    }
  };

  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) { flush(); continue; }
    if (/^#{1,6}\s/.test(stripped)) { flush(); parts.push(stripped); continue; }
    if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(stripped)) { flush(); parts.push('[图]'); continue; }
    buf.push(line);
  }
  flush();
  return parts;
}
