import { AgentBase } from "../agent-base.js";
import { loadPrompt } from "../prompts/index.js";

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
}

export interface Round2Input {
  projectId: string;
  runId: string;
  candidatesMd: string;
}

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

  round1(input: Round1Input) {
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
    return base.run("");
  }

  round2(input: Round2Input) {
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
    return base.run("");
  }
}
