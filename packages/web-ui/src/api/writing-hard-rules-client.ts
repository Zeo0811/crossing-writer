export interface HardRulePhrase { pattern: string; is_regex: boolean; reason: string; example?: string }
export interface HardRuleVocabulary { word: string; reason: string }
export interface WritingHardRules {
  version: 1;
  updated_at: string;
  banned_phrases: HardRulePhrase[];
  banned_vocabulary: HardRuleVocabulary[];
  layout_rules: string[];
}

export async function getWritingHardRules(): Promise<WritingHardRules> {
  const res = await fetch('/api/config/writing-hard-rules');
  if (!res.ok) throw new Error(`GET hard-rules failed: ${res.status}`);
  return res.json();
}

export async function putWritingHardRules(rules: WritingHardRules): Promise<void> {
  const res = await fetch('/api/config/writing-hard-rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rules),
  });
  if (!res.ok) throw new Error(`PUT hard-rules failed: ${res.status}: ${await res.text()}`);
}
