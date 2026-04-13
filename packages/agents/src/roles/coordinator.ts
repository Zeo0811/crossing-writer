import { AgentBase } from "../agent-base.js";
import { loadPrompt } from "../prompts/index.js";

export interface CoordinatorOpts {
  cli: "claude" | "codex";
  model?: string;
}

export interface Round1SynthInput {
  projectId: string;
  runId: string;
  briefSummary: string;
  refsPack: string;
  round1Bundle: string;
  experts: string[];
}

export interface Round2AggregateInput {
  candidatesMd: string;
  round2Bundle: string;
}

export class Coordinator {
  constructor(private opts: CoordinatorOpts) {}

  round1Synthesize(input: Round1SynthInput) {
    const template = loadPrompt("coordinator-round1");
    const base = new AgentBase({
      key: "coordinator",
      systemPromptTemplate: template,
      vars: {
        project_id: input.projectId,
        run_id: input.runId,
        now: new Date().toISOString(),
        model_used: this.opts.model ?? "auto",
        brief_summary: input.briefSummary,
        refs_pack: input.refsPack,
        round1_bundle: input.round1Bundle,
        experts_list_json: JSON.stringify(input.experts),
      },
      cli: this.opts.cli,
      model: this.opts.model,
    });
    return base.run("");
  }

  round2Aggregate(input: Round2AggregateInput) {
    const template = loadPrompt("coordinator-round2");
    const base = new AgentBase({
      key: "coordinator",
      systemPromptTemplate: template,
      vars: {
        candidates_md: input.candidatesMd,
        round2_bundle: input.round2Bundle,
      },
      cli: this.opts.cli,
      model: this.opts.model,
    });
    return base.run("");
  }
}
