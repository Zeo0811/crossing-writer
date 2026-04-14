import type { TopicExpertStore } from "./topic-expert-store.js";

export interface DistillArgs {
  expertName: string;
  seedUrls?: string[];
  mode: "initial" | "redistill";
  cli?: "claude" | "codex";
  model?: string;
}

export interface DistillEvent {
  type:
    | "distill.started"
    | "ingest_progress"
    | "distill_progress"
    | "distill.done"
    | "distill.failed";
  data: Record<string, unknown>;
}

export interface IngestArticle {
  url: string;
  title: string;
  body: string;
}

export interface DistillDeps {
  store: TopicExpertStore;
  ingest: (
    urls: string[],
    onProgress?: (a: IngestArticle) => void,
  ) => Promise<{ articles: IngestArticle[] }>;
  distill: (input: {
    name: string;
    articles: IngestArticle[];
    cli: string;
    model?: string;
    onProgress?: (d: Record<string, unknown>) => void;
  }) => Promise<{ markdown: string; version?: number }>;
  emit: (ev: DistillEvent) => void;
}

export async function runTopicExpertDistill(
  args: DistillArgs,
  deps: DistillDeps,
): Promise<{ version: number; backupPath?: string }> {
  const { store, ingest, distill, emit } = deps;
  emit({
    type: "distill.started",
    data: {
      expertName: args.expertName,
      mode: args.mode,
      seedCount: args.seedUrls?.length ?? 0,
    },
  });
  try {
    const prev = await store.get(args.expertName);
    if (!prev) throw new Error(`expert not found: ${args.expertName}`);
    let backupPath: string | undefined;
    if (args.mode === "redistill" && prev.kb_markdown.trim()) {
      const p = await store.backupKb(args.expertName);
      if (p) backupPath = p;
    }
    const { articles } = await ingest(args.seedUrls ?? [], (a) => {
      emit({ type: "ingest_progress", data: { url: a.url, title: a.title } });
    });
    const { markdown } = await distill({
      name: args.expertName,
      articles,
      cli: args.cli ?? "claude",
      model: args.model,
      onProgress: (d) => emit({ type: "distill_progress", data: d }),
    });
    const nextVersion = (prev.version ?? 0) + 1;
    await store.writeKb(args.expertName, markdown, {
      distilled_from: args.seedUrls ?? [],
      distilled_at: new Date().toISOString(),
      version: nextVersion,
    });
    emit({
      type: "distill.done",
      data: { expertName: args.expertName, version: nextVersion, backupPath: backupPath ?? null },
    });
    return { version: nextVersion, backupPath };
  } catch (err: any) {
    emit({ type: "distill.failed", data: { error: String(err?.message ?? err) } });
    throw err;
  }
}
