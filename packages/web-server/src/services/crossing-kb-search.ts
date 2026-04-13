import { searchRefs as kbSearchRefs } from "@crossing/kb";

export interface RefSearchResult {
  mdPath: string;
  title: string;
  account: string;
  date: string;
}

/**
 * Thin async wrapper around @crossing/kb searchRefs.
 * Signature matches what case-inspiration-pack-builder expects.
 */
export async function searchRefs(
  sqlitePath: string,
  query: string,
  limit: number,
): Promise<RefSearchResult[]> {
  const rows = kbSearchRefs(
    { sqlitePath, vaultPath: "" },
    { query, limit },
  );
  return rows.map((r) => ({
    mdPath: r.mdPath,
    title: r.title,
    account: r.account,
    date: r.publishedAt,
  }));
}
