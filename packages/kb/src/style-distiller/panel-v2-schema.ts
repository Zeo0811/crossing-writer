export type ArticleType = '实测' | '访谈' | '评论';
export const ARTICLE_TYPES: ArticleType[] = ['实测', '访谈', '评论'];

export type Role = 'opening' | 'practice' | 'closing' | 'other';
export const WRITER_ROLES: Exclude<Role, 'other'>[] = ['opening', 'practice', 'closing'];

export type TonePrimary =
  | '客观克制' | '热血推荐' | '冷峻分析'
  | '调侃戏谑' | '教学温和' | '专家严肃';
export const TONE_PRIMARY_ENUM: TonePrimary[] = [
  '客观克制', '热血推荐', '冷峻分析', '调侃戏谑', '教学温和', '专家严肃',
];

export interface PanelTypeEntry { key: ArticleType; sample_count: number }
export interface PronounPolicy { we_ratio: number; you_ratio: number; avoid: string[] }
export interface ToneSpec {
  primary: TonePrimary;
  humor_frequency: 'low' | 'mid' | 'high';
  opinionated: 'low' | 'mid' | 'high';
}
export interface BoldPolicy {
  frequency: string;
  what_to_bold: string[];
  dont_bold: string[];
}
export interface DataCitationSpec {
  required: boolean;
  format_style: string;
  min_per_article: number;
}
export interface HeadingCadenceSpec {
  levels_used: string[];
  paragraphs_per_h3: [number, number];
  h3_style: string;
}

export interface PanelFrontmatterV2 {
  account: string;
  role: 'opening' | 'practice' | 'closing';
  version: 2;
  status: 'active' | 'deleted';
  created_at: string;
  source_article_count: number;
  slicer_run_id?: string;
  types: PanelTypeEntry[];
  word_count_ranges: {
    opening: [number, number];
    article: [number, number];
  };
  pronoun_policy: PronounPolicy;
  tone: ToneSpec;
  bold_policy: BoldPolicy;
  transition_phrases: string[];
  data_citation: DataCitationSpec;
  heading_cadence: HeadingCadenceSpec;
  banned_vocabulary: string[];
}

export interface PanelV2 {
  frontmatter: PanelFrontmatterV2;
  body: string;
  absPath: string;
}

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
