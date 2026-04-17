import { useEffect, useMemo, useState } from 'react';
import { getFinal } from '../../api/writer-client.js';
import { RewriteMutexProvider } from '../../hooks/useRewriteMutex.js';
import { SectionCard } from './SectionCard.js';

export interface ArticleFlowProps {
  projectId: string;
}

interface SectionSpec {
  key: string;
  body: string;
}

function parseSections(finalMd: string): SectionSpec[] {
  const re = /<!--\s*section:([^\s]+)\s*-->\n?/g;
  const matches: Array<{ key: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(finalMd))) {
    matches.push({ key: m[1]!, start: m.index, end: re.lastIndex });
  }
  const out: SectionSpec[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const nextStart = i < matches.length - 1 ? matches[i + 1]!.start : finalMd.length;
    const body = finalMd.slice(cur.end, nextStart).trim();
    out.push({ key: cur.key, body });
  }
  return out.filter((s) => !s.key.startsWith('transition.'));
}

function sectionLabel(key: string): string {
  if (key === 'opening') return '开篇';
  if (key === 'closing') return '收束';
  if (key.startsWith('practice.case-')) {
    const n = key.slice('practice.case-'.length);
    return `Case ${parseInt(n, 10)}`;
  }
  return key;
}

export function ArticleFlow({ projectId }: ArticleFlowProps) {
  const [sections, setSections] = useState<SectionSpec[]>([]);

  useEffect(() => {
    getFinal(projectId).then((md) => setSections(parseSections(md))).catch(() => setSections([]));
  }, [projectId]);

  const sidebarItems = useMemo(
    () => sections.map((s) => ({ key: s.key, label: sectionLabel(s.key) })),
    [sections],
  );

  function scrollTo(key: string) {
    const el = document.querySelector(`[data-testid="card-${key}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function copyAll() {
    const md = await getFinal(projectId);
    await navigator.clipboard?.writeText(md);
  }

  return (
    <RewriteMutexProvider>
      <div className="grid grid-cols-[200px_1fr] gap-5">
        <aside className="space-y-1.5 sticky top-4 self-start">
          <div className="text-xs text-[var(--meta)] font-semibold mb-2">段落</div>
          {sidebarItems.map((it) => (
            <button
              key={it.key}
              onClick={() => scrollTo(it.key)}
              className="w-full text-left px-2.5 py-2 rounded text-xs text-[var(--body)] hover:bg-[var(--bg-2)]"
            >
              {it.label}
            </button>
          ))}
          <div className="pt-3 space-y-2">
            <button
              onClick={() => void copyAll()}
              className="w-full px-3 py-2 rounded border border-[var(--hair)] text-xs text-[var(--meta)] hover:text-[var(--heading)]"
            >
              复制全文
            </button>
            <a
              href={`/api/projects/${projectId}/writer/final`}
              download="final.md"
              className="block w-full px-3 py-2 rounded border border-[var(--hair)] text-xs text-[var(--meta)] hover:text-[var(--heading)] text-center no-underline"
            >
              导出 final.md
            </a>
          </div>
        </aside>

        <main className="space-y-4">
          {sections.map((s) => (
            <SectionCard
              key={s.key}
              projectId={projectId}
              sectionKey={s.key}
              label={sectionLabel(s.key)}
              initialBody={s.body}
            />
          ))}
        </main>
      </div>
    </RewriteMutexProvider>
  );
}
