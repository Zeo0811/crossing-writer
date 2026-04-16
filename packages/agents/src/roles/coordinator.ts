import { AgentBase } from "../agent-base.js";
import { loadPrompt } from "../prompts/index.js";
import type { AgentResult } from "../model-adapter.js";

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
  images?: string[];
  addDirs?: string[];
}

export interface Round2AggregateInput {
  candidatesMd: string;
  round2Bundle: string;
  images?: string[];
  addDirs?: string[];
}

export interface FinalSynthesizeInput {
  projectId: string;
  runId: string;
  candidatesMd: string;
  peerReviewsBundle: string;
  images?: string[];
  addDirs?: string[];
}

export interface RefineInput {
  projectId: string;
  currentMission: string;
  userFeedback: string;
  refineHistory: string;
  images?: string[];
  addDirs?: string[];
}

export class Coordinator {
  constructor(private opts: CoordinatorOpts) {}

  async round1Synthesize(input: Round1SynthInput): Promise<AgentResult> {
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
    return base.run("", undefined, { images: input.images, addDirs: input.addDirs });
  }

  async round2Aggregate(input: Round2AggregateInput): Promise<AgentResult> {
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
    return base.run("", undefined, { images: input.images, addDirs: input.addDirs });
  }

  async finalSynthesize(input: FinalSynthesizeInput): Promise<AgentResult> {
    const template = loadPrompt("coordinator-final-synthesize");
    const base = new AgentBase({
      key: "coordinator",
      systemPromptTemplate: template,
      vars: {
        project_id: input.projectId,
        run_id: input.runId,
        candidates_md: input.candidatesMd,
        peer_reviews_bundle: input.peerReviewsBundle,
        model_used: this.opts.model ?? "auto",
        now: new Date().toISOString(),
      },
      cli: this.opts.cli,
      model: this.opts.model,
    });
    return base.run("", undefined, { images: input.images, addDirs: input.addDirs });
  }

  async refine(input: RefineInput): Promise<AgentResult> {
    const template = loadPrompt("coordinator-refine");
    const base = new AgentBase({
      key: "coordinator.refine",
      systemPromptTemplate: template,
      vars: {
        project_id: input.projectId,
        current_mission: input.currentMission,
        user_feedback: input.userFeedback,
        refine_history: input.refineHistory,
        model_used: this.opts.model ?? "auto",
        now: new Date().toISOString(),
      },
      cli: this.opts.cli,
      model: this.opts.model,
    });
    return base.run("", undefined, { images: input.images, addDirs: input.addDirs });
  }
}
