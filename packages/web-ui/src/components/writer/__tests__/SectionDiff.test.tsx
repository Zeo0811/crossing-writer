import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SectionDiff } from '../SectionDiff.js';

describe('SectionDiff', () => {
  it('no change → renders text with no highlights', () => {
    const { container } = render(<SectionDiff oldText="hello" newText="hello" />);
    expect(container.querySelector('ins')).toBeNull();
    expect(container.querySelector('del')).toBeNull();
    expect(container.textContent).toContain('hello');
  });

  it('pure insertion → <ins> around new text', () => {
    const { container } = render(<SectionDiff oldText="hello" newText="hello world" />);
    const ins = container.querySelector('ins');
    expect(ins).not.toBeNull();
    expect(ins!.textContent).toContain('world');
    expect(container.querySelector('del')).toBeNull();
  });

  it('pure deletion → <del> around removed text', () => {
    const { container } = render(<SectionDiff oldText="hello world" newText="hello" />);
    const del = container.querySelector('del');
    expect(del).not.toBeNull();
    expect(del!.textContent).toContain('world');
    expect(container.querySelector('ins')).toBeNull();
  });

  it('mixed replacement → both ins and del', () => {
    const { container } = render(<SectionDiff oldText="hello world" newText="hello friend" />);
    expect(container.querySelector('ins')).not.toBeNull();
    expect(container.querySelector('del')).not.toBeNull();
  });

  it('empty old → all new is insertion', () => {
    const { container } = render(<SectionDiff oldText="" newText="new content" />);
    expect(container.querySelector('ins')!.textContent).toContain('new content');
  });
});
