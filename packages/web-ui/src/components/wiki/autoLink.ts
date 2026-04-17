export interface IndexEntry {
  path: string;
  title: string;
  aliases: string[];
}

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; path: string };

interface NameEntry {
  name: string;
  path: string;
}

function buildNameList(index: IndexEntry[], currentPath: string): NameEntry[] {
  const items: NameEntry[] = [];
  for (const e of index) {
    if (e.path === currentPath) continue;
    if (e.title) items.push({ name: e.title, path: e.path });
    for (const a of e.aliases) items.push({ name: a, path: e.path });
  }
  // Longer names first for longest-match priority
  items.sort((a, b) => b.name.length - a.name.length);
  return items;
}

export function splitByIndex(text: string, index: IndexEntry[], currentPath: string): Segment[] {
  if (!text) return [];
  const names = buildNameList(index, currentPath);
  if (names.length === 0) return [{ kind: "text", text }];
  const out: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    let matched: NameEntry | null = null;
    for (const ne of names) {
      if (ne.name.length === 0) continue;
      if (text.startsWith(ne.name, i)) { matched = ne; break; }
    }
    if (matched) {
      out.push({ kind: "link", text: matched.name, path: matched.path });
      i += matched.name.length;
    } else {
      // accumulate into last text segment
      if (out.length > 0 && out[out.length - 1]!.kind === "text") {
        (out[out.length - 1] as { kind: "text"; text: string }).text += text[i]!;
      } else {
        out.push({ kind: "text", text: text[i]! });
      }
      i += 1;
    }
  }
  return out;
}
