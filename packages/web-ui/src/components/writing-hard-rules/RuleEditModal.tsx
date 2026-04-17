import { useState, useEffect } from 'react';
import { Button } from '../ui';

export type RuleKind = 'phrase' | 'vocabulary' | 'layout' | 'word_count';

interface FieldSpec {
  key: string;
  label: string;
  required?: boolean;
  type?: 'bool' | 'number';
}

export interface RuleEditModalProps {
  kind: RuleKind;
  initialValue: Record<string, any> | null;
  onCancel: () => void;
  onSubmit: (value: Record<string, any>) => void;
}

const FIELDS: Record<RuleKind, FieldSpec[]> = {
  phrase: [
    { key: 'pattern', label: '句式 / 模式', required: true },
    { key: 'is_regex', label: '是否正则', type: 'bool' },
    { key: 'reason', label: '原因', required: true },
    { key: 'example', label: '示例（可选）' },
  ],
  vocabulary: [
    { key: 'word', label: '词汇', required: true },
    { key: 'reason', label: '原因', required: true },
  ],
  layout: [
    { key: 'rule', label: '规则文本', required: true },
  ],
  word_count: [
    { key: 'role', label: '角色 (opening / closing / article)', required: true },
    { key: 'min', label: '最小字数', required: true, type: 'number' },
    { key: 'max', label: '最大字数', required: true, type: 'number' },
  ],
};

function defaultFor(kind: RuleKind): Record<string, any> {
  if (kind === 'phrase') return { pattern: '', is_regex: false, reason: '', example: '' };
  if (kind === 'vocabulary') return { word: '', reason: '' };
  if (kind === 'word_count') return { role: '', min: 0, max: 0 };
  return { rule: '' };
}

export function RuleEditModal({ kind, initialValue, onCancel, onSubmit }: RuleEditModalProps) {
  const fields = FIELDS[kind];
  const [state, setState] = useState<Record<string, any>>(initialValue ?? defaultFor(kind));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState(initialValue ?? defaultFor(kind));
    setError(null);
  }, [initialValue, kind]);

  function save() {
    for (const f of fields) {
      const v = state[f.key];
      const isEmpty = v === undefined || v === null || v === '';
      if (f.required && isEmpty) {
        setError(`${f.label} 是必填`);
        return;
      }
    }
    if (kind === 'layout') onSubmit({ text: state.rule });
    else onSubmit(state);
  }

  return (
    <div
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.55)] backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[440px] rounded border border-[var(--hair-strong)] bg-[var(--bg-1)] p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-[var(--heading)]">
          {initialValue ? '编辑规则' : '新增规则'}
        </h3>
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="text-xs text-[var(--meta)] block mb-1">
              {f.label}{f.required && <span className="text-[var(--red)]"> *</span>}
            </span>
            {f.type === 'bool' ? (
              <input
                type="checkbox"
                checked={!!state[f.key]}
                onChange={(e) => setState({ ...state, [f.key]: e.target.checked })}
              />
            ) : f.type === 'number' ? (
              <input
                type="number"
                value={state[f.key] ?? ''}
                onChange={(e) => setState({
                  ...state,
                  [f.key]: e.target.value === '' ? '' : Number(e.target.value),
                })}
                className="w-full h-9 px-2 rounded border border-[var(--hair)] bg-[var(--bg-0)] text-sm text-[var(--body)]"
              />
            ) : (
              <input
                type="text"
                value={state[f.key] ?? ''}
                onChange={(e) => setState({ ...state, [f.key]: e.target.value })}
                className="w-full h-9 px-2 rounded border border-[var(--hair)] bg-[var(--bg-0)] text-sm text-[var(--body)]"
              />
            )}
          </label>
        ))}
        {error && <div className="text-xs text-[var(--red)]">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onCancel}>取消</Button>
          <Button variant="primary" onClick={save}>保存</Button>
        </div>
      </div>
    </div>
  );
}
