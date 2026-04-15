import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/product-overview.md"),
  "utf-8",
);

export interface OverviewInput {
  briefImages: string[];
  screenshots: string[];
  productFetchedMd: string;
  userDescription: string;
  missionSummary: string;
}

export interface OverviewOutput {
  text: string;
  meta: { cli: string; model?: string | null; durationMs: number };
}

export class ProductOverviewAgent {
  constructor(
    private opts: { cli: "claude" | "codex"; model?: string },
  ) {}

  async analyze(input: OverviewInput): Promise<OverviewOutput> {
    const allImages = [...input.briefImages, ...input.screenshots];
    if (allImages.length === 0) {
      throw new Error("at least one image required");
    }
    const userMessage = [
      "# Mission 摘要",
      input.missionSummary || "(无)",
      "",
      "# 产品 URL 抓取内容",
      input.productFetchedMd || "(无)",
      "",
      "# 用户补充描述",
      input.userDescription || "(无)",
      "",
      `# 图片清单`,
      `- Brief 配图: ${input.briefImages.length} 张`,
      `- 产品截图: ${input.screenshots.length} 张`,
      "",
      "请按 system prompt 要求输出 product-overview markdown。",
    ].join("\n");

    const result = await invokeAgent({
      agentKey: "product_overview",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      images: allImages,
    });
    return {
      text: result.text,
      meta: {
        cli: result.meta.cli,
        model: result.meta.model ?? null,
        durationMs: result.meta.durationMs,
      },
    };
  }
}
