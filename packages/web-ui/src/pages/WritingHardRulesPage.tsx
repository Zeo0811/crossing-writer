import { useEffect, useState } from 'react';
import {
  getWritingHardRules, putWritingHardRules, type WritingHardRules,
} from '../api/writing-hard-rules-client';
import { RulesSection } from '../components/writing-hard-rules/RulesSection';
import { useToast } from '../components/ui/ToastProvider';

export function WritingHardRulesPage() {
  const [rules, setRules] = useState<WritingHardRules | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    getWritingHardRules()
      .then(setRules)
      .catch(() => toast.error('加载失败'));
  }, []);

  function update(patch: Partial<WritingHardRules>) {
    setRules((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }

  async function save() {
    if (!rules) return;
    setSaving(true);
    try {
      await putWritingHardRules(rules);
      toast.success('已保存');
      setDirty(false);
    } catch (e) {
      toast.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  if (!rules) {
    return <div className="p-12 text-center text-[var(--meta)]">加载中…</div>;
  }

  return (
    <div className="space-y-5" data-testid="page-writing-hard-rules">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--heading)]">写作硬规则</h1>
          <p className="text-xs text-[var(--meta)] mt-1">全局生效，跨所有账号和文章类型</p>
        </div>
        {dirty && (
          <button
            onClick={save}
            disabled={saving}
            className="h-9 px-4 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        )}
      </header>

      <RulesSection
        title="禁用句式"
        kind="phrase"
        rows={rules.banned_phrases}
        columns={[
          { key: 'pattern', label: 'pattern' },
          { key: 'is_regex', label: 'regex', render: (r: any) => (r.is_regex ? '✓' : '—') },
          { key: 'reason', label: 'reason' },
        ]}
        onAdd={(v) => update({ banned_phrases: [...rules.banned_phrases, v] })}
        onEdit={(i, v) => {
          const next = [...rules.banned_phrases];
          next[i] = v;
          update({ banned_phrases: next });
        }}
        onDelete={(i) => update({ banned_phrases: rules.banned_phrases.filter((_, j) => j !== i) })}
      />

      <RulesSection
        title="禁用词汇"
        kind="vocabulary"
        rows={rules.banned_vocabulary}
        columns={[
          { key: 'word', label: 'word' },
          { key: 'reason', label: 'reason' },
        ]}
        onAdd={(v) => update({ banned_vocabulary: [...rules.banned_vocabulary, v] })}
        onEdit={(i, v) => {
          const next = [...rules.banned_vocabulary];
          next[i] = v;
          update({ banned_vocabulary: next });
        }}
        onDelete={(i) => update({ banned_vocabulary: rules.banned_vocabulary.filter((_, j) => j !== i) })}
      />

      <RulesSection
        title="排版规则"
        kind="layout"
        rows={rules.layout_rules.map((r) => ({ text: r }))}
        columns={[{ key: 'text', label: 'rule' }]}
        onAdd={(v) => update({ layout_rules: [...rules.layout_rules, v.text] })}
        onEdit={(i, v) => {
          const next = [...rules.layout_rules];
          next[i] = v.text;
          update({ layout_rules: next });
        }}
        onDelete={(i) => update({ layout_rules: rules.layout_rules.filter((_, j) => j !== i) })}
      />
    </div>
  );
}
