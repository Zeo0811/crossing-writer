/**
 * Strip conversational preambles that Claude sometimes emits before the requested
 * structured output, and unwrap ```markdown fences that wrap the whole output.
 *
 * Examples handled:
 *   "根据您的要求，我输出...\n\n---\n..."     → "---\n..."
 *   "以下是更新后的 candidates.md：\n```markdown\n<content>\n```"  → "<content>"
 *   "我无法使用文件读取工具，但...\n\n# 概览\n..."  → "# 概览\n..."
 */
export function stripAgentPreamble(raw: string): string {
  let text = raw.trim();

  // 1. Unwrap ```markdown ... ``` fence if it wraps (almost) the whole output
  const fenceMatch = text.match(/^([\s\S]*?)```(?:markdown|md)?\s*\n([\s\S]+?)\n```[\s\S]*$/i);
  if (fenceMatch && fenceMatch[2]) {
    // Only unwrap if the fenced content is most of the output
    const inner = fenceMatch[2].trim();
    if (inner.length > text.length * 0.5) text = inner;
  }

  // 2. Strip conversational preamble up to first structural anchor:
  //    - YAML frontmatter `---` at line start
  //    - Markdown heading `# ` / `## ` at line start
  //    - HTML comment `<!--`
  const lines = text.split("\n");
  let anchor = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith("---") || l.startsWith("# ") || l.startsWith("## ") || l.startsWith("<!--")) {
      anchor = i;
      break;
    }
  }
  if (anchor > 0) {
    // Only strip if the preamble is conversational (short, no structural markers)
    const preamble = lines.slice(0, anchor).join("\n");
    const hasStructural = /^#{1,6}\s|\n#{1,6}\s|^\|.*\|/m.test(preamble);
    if (!hasStructural) {
      text = lines.slice(anchor).join("\n");
    }
  }

  return text.trim();
}
