import { AgentBase } from "../agent-base.js";
import { loadPrompt } from "../prompts/index.js";

export interface BriefAnalyzeInput {
  projectId: string;
  briefBody: string;
  productInfo: string;
  images?: string[];   // absolute paths; passed via @-ref to claude + added to --add-dir
  addDirs?: string[];  // absolute dirs to grant CLI access to
}

export class BriefAnalyst {
  private base: AgentBase;
  private model?: string;

  constructor(opts: { cli: "claude" | "codex"; model?: string }) {
    this.model = opts.model;
    const template = loadPrompt("brief-analyst");
    this.base = new AgentBase({
      key: "brief_analyst",
      systemPromptTemplate: template,
      vars: {},
      cli: opts.cli,
      model: opts.model,
    });
  }

  analyze(input: BriefAnalyzeInput) {
    return this.base.run(
      "",
      {
        project_id: input.projectId,
        now: new Date().toISOString(),
        model_used: this.model ?? "auto",
        brief_body: input.briefBody,
        product_info: input.productInfo,
      },
      { images: input.images, addDirs: input.addDirs },
    );
  }
}
