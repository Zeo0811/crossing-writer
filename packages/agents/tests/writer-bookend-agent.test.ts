import { describe, it, expect, vi } from 'vitest';
import { runWriterBookend } from '../src/roles/writer-bookend-agent.js';
import type { PanelFrontmatterLike } from '../src/roles/writer-shared.js';

const PANEL_FM: PanelFrontmatterLike = {
  word_count_ranges: { opening: [150, 260], article: [3500, 8000] },
  pronoun_policy: { we_ratio: 0.4, you_ratio: 0.3, avoid: ['笔者'] },
  tone: { primary: '客观克制', humor_frequency: 'low', opinionated: 'mid' },
  bold_policy: { frequency: '每段 0-2 处', what_to_bold: ['核心句'], dont_bold: ['整段'] },
  transition_phrases: ['先说 XXX'],
  data_citation: { required: true, format_style: '数字+单位+来源', min_per_article: 1 },
};

const TYPE_SECTION = `### 目标
给读者钩子

### 字数范围
150 – 260 字

### 结构骨架（三选一）
**A. 场景** · x

### 高频锚词
- "2013 年"

### 禁止出现
- "本文将"

### 示例
**示例 1** · ColaOS · 结构 A
> 正文
`;

describe('runWriterBookend', () => {
  it('invokes tool runner with role=opening system prompt', async () => {
    const invokeAgent = vi.fn(async () => ({
      text: '测试开头段正文。',
      meta: { cli: 'claude', model: 'claude-opus-4-6', durationMs: 100 },
    }));
    const dispatchTool = vi.fn(async () => ({
      ok: true as const,
      tool: 'search_wiki',
      query: 'x',
      args: {},
      hits: [],
      hits_count: 0,
      formatted: '',
    }));

    const result = await runWriterBookend({
      role: 'opening',
      sectionKey: 'opening',
      account: 'acc',
      articleType: '实测',
      typeSection: TYPE_SECTION,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
      userMessage: 'please write',
      invokeAgent,
      dispatchTool,
    });

    expect(result.finalText).toBe('测试开头段正文。');
    expect(invokeAgent).toHaveBeenCalled();
    const firstCallMessages = invokeAgent.mock.calls[0]![0] as any[];
    const systemMessage = firstCallMessages.find((m: any) => m.role === 'system');
    expect(systemMessage.content).toContain('**开头**');
    expect(systemMessage.content).not.toContain('**结尾**');
    expect(systemMessage.content).toContain('acc');
  });

  it('invokes tool runner with role=closing system prompt', async () => {
    const invokeAgent = vi.fn(async () => ({
      text: '测试结尾段。',
      meta: { cli: 'claude', model: 'claude-opus-4-6', durationMs: 100 },
    }));
    const dispatchTool = vi.fn(async () => ({
      ok: true as const,
      tool: 'search_wiki',
      query: '', args: {}, hits: [], hits_count: 0, formatted: '',
    }));
    const result = await runWriterBookend({
      role: 'closing',
      sectionKey: 'closing',
      account: 'acc',
      articleType: '实测',
      typeSection: TYPE_SECTION,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
      userMessage: 'please write',
      invokeAgent,
      dispatchTool,
    });
    expect(result.finalText).toBe('测试结尾段。');
    const firstCallMessages = invokeAgent.mock.calls[0]![0] as any[];
    const systemMessage = firstCallMessages.find((m: any) => m.role === 'system');
    expect(systemMessage.content).toContain('**结尾**');
    expect(systemMessage.content).not.toContain('**开头**');
  });

  it('passes dispatchTool through to tool runner', async () => {
    const mockResponses = [
      '```tool\nsearch_wiki "acc 怎么写"\n```',
      '这是最终段落。',
    ];
    let callIdx = 0;
    const invokeAgent = vi.fn(async () => ({
      text: mockResponses[callIdx++]!,
      meta: { cli: 'claude', model: 'opus', durationMs: 10 },
    }));
    const dispatchTool = vi.fn(async () => ({
      ok: true as const,
      tool: 'search_wiki',
      query: 'acc 怎么写',
      args: {},
      hits: [],
      hits_count: 0,
      formatted: '(no results)',
    }));
    const out = await runWriterBookend({
      role: 'opening',
      sectionKey: 'opening',
      account: 'acc',
      articleType: '实测',
      typeSection: TYPE_SECTION,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
      userMessage: 'start',
      invokeAgent,
      dispatchTool,
    });
    expect(dispatchTool).toHaveBeenCalledTimes(1);
    expect(out.finalText).toContain('这是最终段落。');
    expect(out.rounds).toBe(2);
  });

  it('passes wordOverride through to renderBookendPrompt', async () => {
    const invokeAgent = vi.fn(async () => ({
      text: '段落正文。',
      meta: { cli: 'claude', model: 'opus', durationMs: 10 },
    }));
    const dispatchTool = vi.fn();
    await runWriterBookend({
      role: 'opening',
      sectionKey: 'opening',
      account: 'acc',
      articleType: '实测',
      typeSection: `### 字数范围\n10 – 110 字(单段)\n\n### 目标\nx\n`,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
      userMessage: 'x',
      wordOverride: [200, 400],
      invokeAgent,
      dispatchTool: dispatchTool as any,
    });
    const systemMsg = (invokeAgent.mock.calls[0]![0] as any[]).find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain('200');
    expect(systemMsg.content).toContain('400');
    expect(systemMsg.content).toContain('硬规则指定');
  });
});
