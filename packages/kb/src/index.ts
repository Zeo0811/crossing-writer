export { searchRefs, getRefByUrl } from "./search.js";
export { loadConfig, openDb } from "./db.js";
export type { SearchOptions, SearchResult } from "./types.js";
export type { KbConfig } from "./db.js";
export type { SearchCtx } from "./search.js";
export { runDistill } from "./style-distiller/orchestrator.js";
export type { DistillContext } from "./style-distiller/orchestrator.js";
export type { DistillOptions, DistillResult, DistillStep, DistillStepEvent, QuantResult, ArticleSample, SnippetCandidate } from "./style-distiller/types.js";
export { analyzeQuant } from "./style-distiller/quant-analyzer.js";
export { stratifiedSample, pickDeepRead } from "./style-distiller/sample-picker.js";
export { aggregateSnippets } from "./style-distiller/snippet-aggregator.js";
export { runIngest } from "./wiki/orchestrator.js";
export { WikiStore } from "./wiki/wiki-store.js";
export { searchWiki } from "./wiki/search-wiki.js";
export { rebuildIndex } from "./wiki/index-maintainer.js";
export type {
  WikiKind, WikiFrontmatter, WikiPage, PatchOp,
  IngestMode, IngestOptions, IngestResult, IngestStepEvent,
  SearchWikiInput, SearchWikiResult,
} from "./wiki/types.js";
