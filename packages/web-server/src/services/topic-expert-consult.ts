import type {
  TopicExpertInvokeType,
  invokeTopicExpert as invokeTopicExpertType,
} from "@crossing/agents";
import type { TopicExpertStore } from "./topic-expert-store.js";
import {
  type ContextBundleService,
  renderContextBlock,
  trimToBudget,
} from "./context-bundle-service.js";

export interface ConsultEvent {
  type:
    | "topic_consult.started"
    | "expert_started"
    | "expert_delta"
    | "expert_done"
    | "expert_failed"
    | "all_done";
  data: Record<string, unknown>;
}

export interface ConsultArgs {
  projectId: string;
  selectedExperts: string[];
  invokeType: TopicExpertInvokeType;
  brief?: string;
  productContext?: string;
  candidatesMd?: string;
  currentDraft?: string;
  focus?: string;
  cli?: "claude" | "codex";
  model?: string;
}

export interface ConsultDeps {
  store: TopicExpertStore;
  invoke: typeof invokeTopicExpertType;
  emit: (ev: ConsultEvent) => void;
  concurrency?: number;
  /** SP-19: optional unified ContextBundle service — when supplied, a
   *  `[Project Context]` block is prepended to the `briefSummary` sent to
   *  every topic-expert invocation so all agents share the project snapshot. */
  contextBundleService?: ContextBundleService;
}

export async function runTopicExpertConsult(
  args: ConsultArgs,
  deps: ConsultDeps,
): Promise<{ succeeded: string[]; failed: string[] }> {
  const concurrency = deps.concurrency ?? 3;
  const succeeded: string[] = [];
  const failed: string[] = [];

  // SP-19: build a single bundle per consult and reuse on every expert call.
  let contextBlock = "";
  if (deps.contextBundleService) {
    try {
      const bundle = trimToBudget(await deps.contextBundleService.build(args.projectId));
      contextBlock = `${renderContextBlock(bundle)}\n\n`;
    } catch {
      contextBlock = "";
    }
  }

  deps.emit({
    type: "topic_consult.started",
    data: { invokeType: args.invokeType, selected: args.selectedExperts },
  });

  async function runOne(name: string): Promise<void> {
    deps.emit({ type: "expert_started", data: { name } });
    try {
      const detail = await deps.store.get(name);
      if (!detail) {
        deps.emit({ type: "expert_failed", data: { name, error: "kb not found" } });
        failed.push(name);
        return;
      }
      const invokeArgs: Parameters<typeof invokeTopicExpertType>[0] = {
        name,
        kbContent: detail.kb_markdown,
        kbSource: `08_experts/topic-panel/experts/${name}_kb.md`,
        cli: args.cli ?? "claude",
        model: args.model,
        invokeType: args.invokeType,
        projectId: args.projectId,
        runId: `topic-consult-${Date.now()}`,
      };
      if (args.invokeType === "score") {
        invokeArgs.briefSummary = `${contextBlock}${args.brief ?? ""}`;
        invokeArgs.refsPack = args.productContext ?? "";
      } else if (args.invokeType === "structure") {
        invokeArgs.candidatesMd = `${contextBlock}${args.candidatesMd ?? ""}`;
      } else if (args.invokeType === "continue") {
        invokeArgs.currentDraft = `${contextBlock}${args.currentDraft ?? ""}`;
        invokeArgs.focus = args.focus;
      }
      const result = await deps.invoke(invokeArgs);
      deps.emit({
        type: "expert_done",
        data: { name, markdown: result.markdown, tokens: null, meta: result.meta },
      });
      succeeded.push(name);
    } catch (err: any) {
      deps.emit({
        type: "expert_failed",
        data: { name, error: String(err?.message ?? err) },
      });
      failed.push(name);
    }
  }

  // promise-pool with capacity
  const queue = [...args.selectedExperts];
  const active = new Set<Promise<void>>();
  while (queue.length > 0 || active.size > 0) {
    while (active.size < concurrency && queue.length > 0) {
      const name = queue.shift()!;
      const p = runOne(name).finally(() => active.delete(p));
      active.add(p);
    }
    if (active.size > 0) {
      await Promise.race(active);
    }
  }

  deps.emit({ type: "all_done", data: { succeeded, failed } });
  return { succeeded, failed };
}
