import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolTimeline, type TimelineEvent } from '../ToolTimeline.js';

describe('ToolTimeline', () => {
  it('renders empty state when no events', () => {
    render(<ToolTimeline events={[]} />);
    expect(screen.getByText(/暂无活动/)).toBeInTheDocument();
  });

  it('renders tool_called event', () => {
    const events: TimelineEvent[] = [
      { kind: 'tool_called', tool: 'search_wiki', args: { query: 'trae' }, ts: 1000 },
    ];
    render(<ToolTimeline events={events} />);
    expect(screen.getByText(/search_wiki/)).toBeInTheDocument();
    expect(screen.getByText(/trae/)).toBeInTheDocument();
  });

  it('renders tool_returned with hits count', () => {
    const events: TimelineEvent[] = [
      { kind: 'tool_returned', tool: 'search_wiki', hits_count: 5, duration_ms: 42, ts: 1001 },
    ];
    render(<ToolTimeline events={events} />);
    expect(screen.getByText(/search_wiki/)).toBeInTheDocument();
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it('renders validation_passed with attempt + chars', () => {
    const events: TimelineEvent[] = [
      { kind: 'validation_passed', attempt: 1, chars: 312, ts: 2000 },
    ];
    render(<ToolTimeline events={events} />);
    expect(screen.getByText(/validation_passed/i)).toBeInTheDocument();
    expect(screen.getByText(/312/)).toBeInTheDocument();
  });

  it('renders validation_retry with violation count', () => {
    const events: TimelineEvent[] = [
      { kind: 'validation_retry', violations: [{ kind: 'word_count' }, { kind: 'banned_phrase' }], ts: 3000 },
    ];
    render(<ToolTimeline events={events} />);
    expect(screen.getByText(/validation_retry/i)).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it('renders multiple events in order', () => {
    const events: TimelineEvent[] = [
      { kind: 'tool_called', tool: 'search_wiki', args: {}, ts: 1000 },
      { kind: 'tool_returned', tool: 'search_wiki', hits_count: 5, duration_ms: 42, ts: 1042 },
      { kind: 'validation_passed', attempt: 1, chars: 300, ts: 2000 },
      { kind: 'rewrite_completed', ts: 2001 },
    ];
    render(<ToolTimeline events={events} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
  });
});
