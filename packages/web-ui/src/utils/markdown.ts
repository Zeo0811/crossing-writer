/**
 * 剥离 YAML frontmatter，返回 { frontmatter: parsed k/v, body: string }
 * 简化解析：只处理 --- frontmatter --- body 的结构，不支持嵌套。
 */
export interface ParsedMd {
  frontmatter: Record<string, string>;
  body: string;
}

export function stripFrontmatter(md: string): ParsedMd {
  if (!md.startsWith("---")) return { frontmatter: {}, body: md };
  const end = md.indexOf("\n---", 3);
  if (end < 0) return { frontmatter: {}, body: md };
  const raw = md.slice(3, end).trim();
  const body = md.slice(end + 4).replace(/^\n+/, "");
  const frontmatter: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (m) frontmatter[m[1]!] = m[2]!.trim();
  }
  return { frontmatter, body };
}
