export type PinEntry =
  | {
      ok: true;
      tool: string;
      query: string;
      args: Record<string, string>;
      hits: unknown[];
      hits_count: number;
      formatted: string;
      pinned_by: `manual:${string}`;
    }
  | {
      ok: false;
      tool: string;
      query: string;
      args: Record<string, string>;
      error: string;
      pinned_by: `manual:${string}`;
    };

class PendingPinsStore {
  private map = new Map<string, Map<string, PinEntry[]>>();
  push(projectId: string, sectionKey: string, entry: PinEntry) {
    if (!this.map.has(projectId)) this.map.set(projectId, new Map());
    const inner = this.map.get(projectId)!;
    if (!inner.has(sectionKey)) inner.set(sectionKey, []);
    inner.get(sectionKey)!.push(entry);
  }
  list(projectId: string, sectionKey: string): PinEntry[] {
    return this.map.get(projectId)?.get(sectionKey) ?? [];
  }
  clear(projectId: string, sectionKey: string) {
    this.map.get(projectId)?.get(sectionKey)?.splice(0);
  }
  removeAt(projectId: string, sectionKey: string, index: number) {
    const arr = this.map.get(projectId)?.get(sectionKey);
    if (arr && index >= 0 && index < arr.length) arr.splice(index, 1);
  }
}

export const pendingPinsStore = new PendingPinsStore();
