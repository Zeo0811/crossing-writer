import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MentionDropdown, SKILL_ITEMS } from '../MentionDropdown.js';

describe('MentionDropdown', () => {
  it('renders nothing when items empty', () => {
    const { container } = render(<MentionDropdown items={[]} activeIndex={0} onSelect={() => {}} onHover={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all skill items', () => {
    render(<MentionDropdown items={SKILL_ITEMS} activeIndex={0} onSelect={() => {}} onHover={() => {}} />);
    expect(screen.getByText('search_wiki')).toBeInTheDocument();
    expect(screen.getByText('search_raw')).toBeInTheDocument();
  });

  it('marks active index with aria-selected', () => {
    render(<MentionDropdown items={SKILL_ITEMS} activeIndex={1} onSelect={() => {}} onHover={() => {}} />);
    const options = screen.getAllByRole('option');
    expect(options[1]!.getAttribute('aria-selected')).toBe('true');
    expect(options[0]!.getAttribute('aria-selected')).toBe('false');
  });

  it('fires onSelect when clicked', () => {
    const onSelect = vi.fn();
    render(<MentionDropdown items={SKILL_ITEMS} activeIndex={0} onSelect={onSelect} onHover={() => {}} />);
    fireEvent.click(screen.getByText('search_wiki'));
    expect(onSelect).toHaveBeenCalledWith(SKILL_ITEMS[0]);
  });
});
