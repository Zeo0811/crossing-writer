import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ArticleFlow } from '../ArticleFlow.js';

vi.mock('../../../api/writer-client.js', () => ({
  getFinal: vi.fn(),
  rewriteSectionStream: vi.fn(async () => {}),
  putSection: vi.fn(async () => {}),
}));

beforeEach(async () => {
  const mod = await import('../../../api/writer-client.js');
  (mod.getFinal as any).mockReset();
  (mod.getFinal as any).mockResolvedValue(`<!-- section:opening -->
**TRAE** 开头

<!-- section:practice.case-01 -->
Case 1 正文

<!-- section:closing -->
收尾段落
`);
});

describe('ArticleFlow', () => {
  it('parses final.md markers and renders one card per section', async () => {
    render(<ArticleFlow projectId="p" />);
    await waitFor(() => {
      expect(screen.getByTestId('card-opening')).toBeInTheDocument();
      expect(screen.getByTestId('card-practice.case-01')).toBeInTheDocument();
      expect(screen.getByTestId('card-closing')).toBeInTheDocument();
    });
  });

  it('skips transition.* markers (not editable)', async () => {
    const mod = await import('../../../api/writer-client.js');
    (mod.getFinal as any).mockResolvedValueOnce(`<!-- section:opening -->
opening
<!-- section:transition.case-01-to-case-02 -->
transition body
<!-- section:closing -->
closing
`);
    render(<ArticleFlow projectId="p" />);
    await waitFor(() => {
      expect(screen.queryByTestId('card-transition.case-01-to-case-02')).toBeNull();
    });
  });

  it('sidebar lists all editable sections', async () => {
    render(<ArticleFlow projectId="p" />);
    await waitFor(() => {
      // Sidebar + card header both contain these labels; use getAllByText
      const openingOccurrences = screen.getAllByText('开篇');
      const closingOccurrences = screen.getAllByText('收束');
      expect(openingOccurrences.length).toBeGreaterThanOrEqual(1);
      expect(closingOccurrences.length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Case 1').length).toBeGreaterThanOrEqual(1);
    });
  });
});
