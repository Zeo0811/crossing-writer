import { useState, type ReactNode } from 'react';
import { Button } from '../ui';
import { RuleEditModal, type RuleKind } from './RuleEditModal';

interface ColumnDef<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
}

export interface RulesSectionProps<T> {
  title: string;
  kind: RuleKind;
  rows: T[];
  columns: ColumnDef<T>[];
  onAdd: (value: any) => void;
  onEdit: (idx: number, value: any) => void;
  onDelete: (idx: number) => void;
}

export function RulesSection<T>({
  title, kind, rows, columns, onAdd, onEdit, onDelete,
}: RulesSectionProps<T>) {
  const [modal, setModal] = useState<{ mode: 'new' } | { mode: 'edit'; idx: number } | null>(null);

  return (
    <section className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-4 h-11 border-b border-[var(--hair)]">
        <h2 className="text-sm font-semibold text-[var(--heading)]">{title}</h2>
        <Button size="sm" variant="primary" onClick={() => setModal({ mode: 'new' })}>新增</Button>
      </header>
      <div className="p-3">
        {rows.length === 0 ? (
          <div className="text-xs text-[var(--faint)] text-center py-6">（无）</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--meta)] uppercase">
                {columns.map((c) => (
                  <th key={c.key} className="text-left pb-2 pr-3 font-normal">{c.label}</th>
                ))}
                <th className="pb-2 w-24" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-t border-[var(--hair)] hover:bg-[var(--bg-2)]">
                  {columns.map((c) => (
                    <td key={c.key} className="py-2 pr-3 align-top">
                      {c.render ? c.render(row) : String((row as any)[c.key] ?? '')}
                    </td>
                  ))}
                  <td className="py-2 flex gap-2 justify-end">
                    <button
                      onClick={() => setModal({ mode: 'edit', idx })}
                      className="text-xs text-[var(--accent)] hover:underline"
                    >编辑</button>
                    <button
                      onClick={() => { if (window.confirm('删除？')) onDelete(idx); }}
                      className="text-xs text-[var(--red)] hover:underline"
                    >删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {modal && (
        <RuleEditModal
          kind={kind}
          initialValue={modal.mode === 'edit' ? (rows[modal.idx] as any) : null}
          onCancel={() => setModal(null)}
          onSubmit={(v) => {
            if (modal.mode === 'new') onAdd(v);
            else onEdit(modal.idx, v);
            setModal(null);
          }}
        />
      )}
    </section>
  );
}
