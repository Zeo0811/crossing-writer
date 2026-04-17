import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SectionCard } from '../SectionCard.js';
import { RewriteMutexProvider } from '../../../hooks/useRewriteMutex.js';
import type { ReactNode } from 'react';

vi.mock('../../../api/writer-client.js', () => ({
  rewriteSectionStream: vi.fn(async () => {}),
  putSection: vi.fn(async () => {}),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <RewriteMutexProvider>{children}</RewriteMutexProvider>
);

beforeEach(async () => {
  const mod = await import('../../../api/writer-client.js');
  (mod.rewriteSectionStream as any).mockReset();
  (mod.putSection as any).mockReset();
  (mod.putSection as any).mockResolvedValue(undefined);
  (mod.rewriteSectionStream as any).mockResolvedValue(undefined);
});

describe('SectionCard', () => {
  it('renders in view mode by default, shows markdown body', () => {
    render(
      <SectionCard projectId="p" sectionKey="opening" label="开篇" initialBody="**hello** world" />,
      { wrapper },
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText(/world/)).toBeInTheDocument();
    expect(screen.getByText('开篇')).toBeInTheDocument();
  });

  it('shows char count in header', () => {
    render(
      <SectionCard projectId="p" sectionKey="opening" label="开篇" initialBody="hello world" />,
      { wrapper },
    );
    expect(screen.getByText(/11 字/)).toBeInTheDocument();
  });

  it('clicking "编辑" switches to edit mode with textarea', () => {
    render(
      <SectionCard projectId="p" sectionKey="opening" label="开篇" initialBody="hello" />,
      { wrapper },
    );
    fireEvent.click(screen.getByText('编辑'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('clicking "改写整段" enters rewrite_idle mode with hint textarea', () => {
    render(
      <SectionCard projectId="p" sectionKey="opening" label="开篇" initialBody="hello" />,
      { wrapper },
    );
    fireEvent.click(screen.getByText('改写整段'));
    expect(screen.getByPlaceholderText(/改写提示/)).toBeInTheDocument();
  });

  it('undo button only appears after accept (not at initial render)', () => {
    render(
      <SectionCard projectId="p" sectionKey="opening" label="开篇" initialBody="hello" />,
      { wrapper },
    );
    expect(screen.queryByText(/撤回/)).toBeNull();
  });
});
