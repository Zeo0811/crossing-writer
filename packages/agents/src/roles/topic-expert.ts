import { AgentBase } from "../agent-base.js";
import { loadPrompt } from "../prompts/index.js";
import type { AgentResult } from "../model-adapter.js";

export interface TopicExpertOpts {
  name: string;
  kbContent: string;
  kbSource: string;
  cli: "claude" | "codex";
  model?: string;
}

export interface Round1Input {
  projectId: string;
  runId: string;
  briefSummary: string;
  refsPack: string;
  images?: string[];
  addDirs?: string[];
}

export interface Round2Input {
  projectId: string;
  runId: string;
  candidatesMd: string;
  images?: string[];
  addDirs?: string[];
}

export interface Round3Input {
  projectId: string;
  runId: string;
  currentDraft: string;
  focus?: string;
  images?: string[];
  addDirs?: string[];
}

export type TopicExpertInvokeType = "score" | "structure" | "continue";

export class TopicExpert {
  constructor(private opts: TopicExpertOpts) {}

  private baseVars() {
    return {
      expert_name: this.opts.name,
      kb_content: this.opts.kbContent,
      kb_source: this.opts.kbSource,
      model_used: this.opts.model ?? "auto",
      now: new Date().toISOString(),
    };
  }

  async round1(input: Round1Input): Promise<AgentResult> {
    const template = loadPrompt("topic-expert-round1");
    const base = new AgentBase({
      key: `topic_expert.${this.opts.name}`,
      systemPromptTemplate: template,
      vars: {
        ...this.baseVars(),
        project_id: input.projectId,
        run_id: input.runId,
        brief_summary: input.briefSummary,
        refs_pack: input.refsPack,
      },
      cli: this.opts.cli,
      model: this.opts.model,
    });
    return base.run("", undefined, { images: input.images, addDirs: input.addDirs });
  }

  async round2(input: Round2Input): Promise<AgentResult> {
    const template = loadPrompt("topic-expert-round2");
    const base = new AgentBase({
      key: `topic_expert.${this.opts.name}`,
      systemPromptTemplate: template,
      vars: {
        ...this.baseVars(),
        project_id: input.projectId,
        run_id: input.runId,
        candidates_md: input.candidatesMd,
      },
      cli: this.opts.cli,
      model: this.opts.model,
    });
    return base.run("", undefined, { images: input.images, addDirs: input.addDirs });
  }

  async round3(input: Round3Input): Promise<AgentResult> {
    const template = loadPrompt("topic-expert-round3");
    const base = new AgentBase({
      key: `topic_expert.${this.opts.name}`,
      systemPromptTemplate: template,
      vars: {
        ...this.baseVars(),
        project_id: input.projectId,
        run_id: input.runId,
        current_draft: input.currentDraft,
        focus: input.focus ?? "",
      },
      cli: this.opts.cli,
      model: this.opts.model,
    });
    return base.run("", undefined, { images: input.images, addDirs: input.addDirs });
  }
}

export interface InvokeTopicExpertArgs {
  name: string;
  kbContent: string;
  kbSource: string;
  cli: "claude" | "codex";
  model?: string;
  invokeType: TopicExpertInvokeType;
  projectId: string;
  runId: string;
  briefSummary?: string;
  refsPack?: string;
  candidatesMd?: string;
  currentDraft?: string;
  focus?: string;
  images?: string[];
  addDirs?: string[];
}

export interface InvokeTopicExpertResult {
  markdown: string;
  meta: { cli: string; model?: string | null; durationMs: number };
}

export async function invokeTopicExpert(
  args: InvokeTopicExpertArgs,
): Promise<InvokeTopicExpertResult> {
  const expert = new TopicExpert({
    name: args.name,
    kbContent: args.kbContent,
    kbSource: args.kbSource,
    cli: args.cli,
    model: args.model,
  });
  let result: AgentResult;
  if (args.invokeType === "score") {
    if (args.briefSummary === undefined || args.refsPack === undefined) {
      throw new Error("invokeTopicExpert(score): requires briefSummary and refsPack");
    }
    result = await expert.round1({
      projectId: args.projectId,
      runId: args.runId,
      briefSummary: args.briefSummary,
      refsPack: args.refsPack,
      images: args.images,
      addDirs: args.addDirs,
    });
  } else if (args.invokeType === "structure") {
    if (args.candidatesMd === undefined) {
      throw new Error("invokeTopicExpert(structure): requires candidatesMd");
    }
    result = await expert.round2({
      projectId: args.projectId,
      runId: args.runId,
      candidatesMd: args.candidatesMd,
      images: args.images,
      addDirs: args.addDirs,
    });
  } else if (args.invokeType === "continue") {
    if (args.currentDraft === undefined) {
      throw new Error("invokeTopicExpert(continue): requires currentDraft");
    }
    result = await expert.round3({
      projectId: args.projectId,
      runId: args.runId,
      currentDraft: args.currentDraft,
      focus: args.focus,
      images: args.images,
      addDirs: args.addDirs,
    });
  } else {
    throw new Error(`invokeTopicExpert: unknown invokeType ${args.invokeType}`);
  }
  return {
    markdown: result.text,
    meta: {
      cli: result.meta.cli,
      model: result.meta.model ?? null,
      durationMs: result.meta.durationMs,
    },
  };
}
