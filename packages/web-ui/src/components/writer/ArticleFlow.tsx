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
  if (key === 'closing') return '结尾';
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
      <div className="grid grid-cols-[1fr_220px] gap-5">
        <main className="space-y-4 min-w-0">
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

        <aside className="sticky top-4 self-start rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
          <div className="px-4 h-10 flex items-center border-b border-[var(--hair)]">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--faint)] font-semibold">段落导航</span>
            <span className="ml-auto text-[10px] text-[var(--faint)] tabular-nums">{sidebarItems.length}</span>
          </div>
          <ol className="py-2">
            {sidebarItems.map((it, i) => (
              <li key={it.key}>
                <button
                  onClick={() => scrollTo(it.key)}
                  className="group w-full flex items-center gap-3 px-4 py-2 text-left text-xs text-[var(--body)] hover:bg-[var(--bg-2)] hover:text-[var(--accent)] transition-colors"
                >
                  <span className="tabular-nums text-[10px] text-[var(--faint)] group-hover:text-[var(--accent-soft)] w-4">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="flex-1">{it.label}</span>
                  <span className="opacity-0 group-hover:opacity-100 text-[var(--accent-soft)] transition-opacity">›</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="border-t border-[var(--hair)] p-3 space-y-1.5 bg-[var(--bg-2)]/40">
            <button
              onClick={() => void copyAll()}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-xs text-[var(--meta)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              复制全文
            </button>
            <a
              href={`/api/projects/${projectId}/writer/final`}
              download="final.md"
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-xs text-[var(--meta)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors no-underline"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              导出 final.md
            </a>
          </div>
        </aside>
      </div>
    </RewriteMutexProvider>
  );
}
