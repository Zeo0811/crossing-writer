import { TOOL_PROTOCOL_PROMPT } from '../prompts/load.js';
import {
  runWriterWithTools,
  type ChatMessage,
  type WriterRunResult,
  type ToolCall,
  type SkillResult,
  type WriterToolEvent,
} from '../writer-tool-runner.js';
import {
  renderBookendPrompt,
  type PanelFrontmatterLike,
} from './writer-shared.js';

export interface RunWriterBookendOpts {
  role: 'opening' | 'closing';
  sectionKey: string;
  account: string;
  articleType: '实测' | '访谈' | '评论';
  typeSection: string;
  panelFrontmatter: PanelFrontmatterLike;
  hardRulesBlock: string;
  projectContextBlock: string;
  product_name?: string;
  guest_name?: string;
  invokeAgent: (
    messages: ChatMessage[],
    opts?: { images?: string[]; addDirs?: string[] },
  ) => Promise<{ text: string; meta: { cli: string; model?: string; durationMs: number } }>;
  userMessage: string;
  images?: string[];
  addDirs?: string[];
  pinnedContext?: string;
  dispatchTool: (call: ToolCall) => Promise<SkillResult>;
  onEvent?: (ev: WriterToolEvent) => void;
  maxRounds?: number;
}

export async function runWriterBookend(opts: RunWriterBookendOpts): Promise<WriterRunResult> {
  const basePrompt = renderBookendPrompt({
    role: opts.role,
    account: opts.account,
    articleType: opts.articleType,
    typeSection: opts.typeSection,
    panelFrontmatter: opts.panelFrontmatter,
    hardRulesBlock: opts.hardRulesBlock,
    projectContextBlock: opts.projectContextBlock,
    product_name: opts.product_name,
    guest_name: opts.guest_name,
  });

  const systemPrompt = `${basePrompt}\n\n${TOOL_PROTOCOL_PROMPT}`;
  const agentName = opts.role === 'opening' ? 'writer.opening' : 'writer.closing';

  return runWriterWithTools({
    agent: { invoke: opts.invokeAgent },
    agentName,
    sectionKey: opts.sectionKey,
    systemPrompt,
    initialUserMessage: opts.userMessage,
    pinnedContext: opts.pinnedContext,
    dispatchTool: opts.dispatchTool,
    onEvent: opts.onEvent,
    images: opts.images,
    addDirs: opts.addDirs,
    maxRounds: opts.maxRounds,
  });
}
