import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import { useTextSelection } from '../useTextSelection.js';

function Probe({ onResult }: { onResult: (r: { text: string; hasRect: boolean }) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const sel = useTextSelection(ref);
  onResult({ text: sel.text, hasRect: sel.rect !== null });
  return <div ref={ref} data-testid="probe">hello world</div>;
}

describe('useTextSelection', () => {
  it('initial state: empty text, null rect', () => {
    let captured: { text: string; hasRect: boolean } = { text: '', hasRect: true };
    render(<Probe onResult={(r) => (captured = r)} />);
    expect(captured.text).toBe('');
    expect(captured.hasRect).toBe(false);
  });
});
