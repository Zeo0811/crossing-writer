export interface SearchOptions {
  query?: string;
  account?: string | string[];
  author?: string;
  dateFrom?: string;
  dateTo?: string;
  topicsCore?: string[];
  topicsFine?: string[];
  isOriginal?: boolean;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  id: string;
  mdPath: string;
  title: string;
  account: string;
  author: string | null;
  publishedAt: string;
  url: string;
  summary: string | null;
  snippet: string;
  topicsCore: string[];
  topicsFine: string[];
  wordCount: number | null;
  score: number;
}
