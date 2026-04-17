export { invokeAgent } from "./model-adapter.js";
export type { InvokeOptions, AgentResult, AgentStreamEvent } from "./model-adapter.js";
export { stripAgentPreamble } from "./util/strip-preamble.js";
export { AgentBase } from "./agent-base.js";
export type { AgentOptions } from "./agent-base.js";
export { loadPrompt } from "./prompts/index.js";
export { parseToolCalls, runCrossingKbSearch } from "./tool-runner.js";
export type { ToolCall, ToolResult } from "./tool-runner.js";
export { loadConfig, resolveAgent } from "./config.js";
export type { AgentConfig, CrossingConfig } from "./config.js";
export { BriefAnalyst } from "./roles/brief-analyst.js";
export type { BriefAnalyzeInput } from "./roles/brief-analyst.js";
export { TopicExpert, invokeTopicExpert } from "./roles/topic-expert.js";
export type {
  TopicExpertOpts,
  Round1Input,
  Round2Input,
  Round3Input,
  TopicExpertInvokeType,
  InvokeTopicExpertArgs,
  InvokeTopicExpertResult,
} from "./roles/topic-expert.js";
export { Coordinator } from "./roles/coordinator.js";
export type { CoordinatorOpts, Round1SynthInput, Round2AggregateInput } from "./roles/coordinator.js";
export { ProductOverviewAgent } from "./roles/product-overview-agent.js";
export type { OverviewInput, OverviewOutput } from "./roles/product-overview-agent.js";
export { CasePlannerExpert } from "./roles/case-planner-expert.js";
export type { CaseExpertOpts, Round1Input as CaseRound1Input, Round2Input as CaseRound2Input, CaseResult } from "./roles/case-planner-expert.js";
export { CaseCoordinator } from "./roles/case-coordinator.js";
export type { SynthesizeInput } from "./roles/case-coordinator.js";
export { runCaseExpert, parseToolCalls as parseCaseToolCalls } from "./case-expert-runner.js";
export type { ToolCall as CaseToolCall, ToolExecutor, RunCaseExpertResult } from "./case-expert-runner.js";
export { runWriterBookend } from "./roles/writer-bookend-agent.js";
export type { RunWriterBookendOpts } from "./roles/writer-bookend-agent.js";
export {
  extractSubsection,
  renderHardRulesBlock,
  renderBookendPrompt,
} from "./roles/writer-shared.js";
export type {
  WritingHardRules,
  PanelFrontmatterLike,
  ReferenceAccountKb,
  WriterOutput,
  RenderBookendPromptOpts,
} from "./roles/writer-shared.js";
export {
  countChars,
  checkWordCount,
  findBannedPhrases,
  findBannedVocabulary,
  validateBookend,
  formatViolations,
} from "./roles/bookend-validator.js";
export type {
  Violation,
  ValidationResult,
  ValidateBookendOpts,
  BannedPhraseRule,
  BannedVocabRule,
} from "./roles/bookend-validator.js";
export { WriterPracticeAgent, runWriterPractice } from "./roles/writer-practice-agent.js";
export type { WriterPracticeInput, RunWriterPracticeOpts } from "./roles/writer-practice-agent.js";
export { PracticeStitcherAgent } from "./roles/practice-stitcher-agent.js";
export type { StitcherInput, StitcherOutput, StitcherCase } from "./roles/practice-stitcher-agent.js";
export { StyleCriticAgent, runStyleCritic } from "./roles/style-critic-agent.js";
export type { StyleCriticInput, StyleCriticOutput, RunStyleCriticOpts } from "./roles/style-critic-agent.js";
export { StyleDistillerStructureAgent } from "./roles/style-distiller-structure-agent.js";
export type { StructureSample, StructureDistillInput, StructureDistillOutput } from "./roles/style-distiller-structure-agent.js";
export { StyleDistillerSnippetsAgent } from "./roles/style-distiller-snippets-agent.js";
export type { SnippetBatchArticle, SnippetHarvestInput, HarvestedSnippet, SnippetHarvestOutput } from "./roles/style-distiller-snippets-agent.js";
export { StyleDistillerComposerAgent } from "./roles/style-distiller-composer-agent.js";
export type { ComposerInput, ComposerOutput } from "./roles/style-distiller-composer-agent.js";
export { runSectionSlicer, DEFAULT_SECTION_SLICER_MODEL } from "./roles/section-slicer.js";
export type {
  SectionSlice,
  SectionRole,
  SectionSlicerOpts,
  SectionSlicerResult,
} from "./roles/section-slicer.js";
export { WikiIngestorAgent, parseNdjsonOps } from "./roles/wiki-ingestor-agent.js";
export type { IngestorInput, IngestorOp, IngestorOutput, IngestArticle, ExistingPageSnapshot } from "./roles/wiki-ingestor-agent.js";
export {
  runWriterWithTools,
  parseToolCalls as parseWriterToolCalls,
} from "./writer-tool-runner.js";
export type {
  ChatMessage,
  AgentInvoker,
  ToolUsage,
  WriterToolEvent,
  WriterRunOptions,
  WriterRunResult,
  SkillResult,
  ToolCall as WriterToolCall,
} from "./writer-tool-runner.js";
export const VERSION = "0.2.0";
