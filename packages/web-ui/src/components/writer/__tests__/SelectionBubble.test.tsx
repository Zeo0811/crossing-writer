import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectionBubble } from '../SelectionBubble.js';

describe('SelectionBubble', () => {
  it('renders nothing when rect is null', () => {
    const { container } = render(<SelectionBubble rect={null} onClick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders button when rect is provided', () => {
    const rect = { top: 100, left: 200, width: 80, height: 20, bottom: 120, right: 280, x: 200, y: 100, toJSON: () => ({}) } as DOMRect;
    render(<SelectionBubble rect={rect} onClick={() => {}} />);
    expect(screen.getByText(/重写选中/)).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const rect = { top: 100, left: 200, width: 80, height: 20, bottom: 120, right: 280, x: 200, y: 100, toJSON: () => ({}) } as DOMRect;
    const onClick = vi.fn();
    render(<SelectionBubble rect={rect} onClick={onClick} />);
    fireEvent.click(screen.getByText(/重写选中/));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
