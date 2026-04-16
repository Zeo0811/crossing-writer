import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

export interface HardRulePhrase {
  pattern: string;
  is_regex: boolean;
  reason: string;
  example?: string;
}
export interface HardRuleVocabulary {
  word: string;
  reason: string;
}
export interface WritingHardRules {
  version: 1;
  updated_at: string;
  banned_phrases: HardRulePhrase[];
  banned_vocabulary: HardRuleVocabulary[];
  layout_rules: string[];
}

const FILENAME = 'writing-hard-rules.yaml';

const DEFAULT_RULES: WritingHardRules = {
  version: 1,
  updated_at: '2026-04-16T00:00:00Z',
  banned_phrases: [
    { pattern: '不是.+?而是', is_regex: true, reason: '烂大街句式', example: '这不是一个工具，而是一个伙伴' },
    { pattern: '[—–]', is_regex: true, reason: '禁止破折号' },
  ],
  banned_vocabulary: [
    { word: '笔者', reason: '第三人称自称不自然' },
    { word: '本人', reason: '同上' },
  ],
  layout_rules: [
    '段落平均字数 ≤ 80',
    '段与段之间必须有空行',
  ],
};

export class HardRulesStore {
  constructor(private readonly rootDir: string) {}

  private get filePath(): string {
    return join(this.rootDir, FILENAME);
  }

  async read(): Promise<WritingHardRules> {
    if (!existsSync(this.filePath)) {
      await this.write(DEFAULT_RULES);
      return DEFAULT_RULES;
    }
    const raw = readFileSync(this.filePath, 'utf-8');
    const parsed = yaml.load(raw) as WritingHardRules;
    if (!parsed || parsed.version !== 1) {
      throw new Error(`writing-hard-rules: unexpected version ${parsed?.version}`);
    }
    return parsed;
  }

  async write(rules: WritingHardRules): Promise<void> {
    mkdirSync(this.rootDir, { recursive: true });
    const toWrite: WritingHardRules = { ...rules, updated_at: new Date().toISOString() };
    const serialized = yaml.dump(toWrite, { lineWidth: -1 });
    const tmp = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, serialized, 'utf-8');
    renameSync(tmp, this.filePath);
  }
}
