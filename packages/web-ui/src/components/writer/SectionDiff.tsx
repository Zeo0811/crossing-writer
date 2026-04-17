import { diffWordsWithSpace } from 'diff';

export interface SectionDiffProps {
  oldText: string;
  newText: string;
}

export function SectionDiff({ oldText, newText }: SectionDiffProps) {
  const parts = diffWordsWithSpace(oldText, newText);
  return (
    <div
      className="text-sm leading-relaxed whitespace-pre-wrap break-words"
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {parts.map((p, i) => {
        if (p.added) {
          return (
            <ins
              key={i}
              className="bg-[var(--accent-fill)] text-[var(--heading)] no-underline px-0.5 rounded-sm"
            >
              {p.value}
            </ins>
          );
        }
        if (p.removed) {
          return (
            <del
              key={i}
              className="bg-[var(--red-fill,#fee2e2)] text-[var(--red,#991b1b)] line-through px-0.5 rounded-sm"
            >
              {p.value}
            </del>
          );
        }
        return <span key={i}>{p.value}</span>;
      })}
    </div>
  );
}
