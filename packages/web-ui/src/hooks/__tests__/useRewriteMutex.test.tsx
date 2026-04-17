import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { RewriteMutexProvider, useRewriteMutex } from '../useRewriteMutex.js';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <RewriteMutexProvider>{children}</RewriteMutexProvider>
);

describe('useRewriteMutex', () => {
  it('initial activeKey is null', () => {
    const { result } = renderHook(() => useRewriteMutex(), { wrapper });
    expect(result.current.activeKey).toBeNull();
  });

  it('acquire returns true when idle, sets activeKey', () => {
    const { result } = renderHook(() => useRewriteMutex(), { wrapper });
    let ok = false;
    act(() => { ok = result.current.acquire('opening'); });
    expect(ok).toBe(true);
    expect(result.current.activeKey).toBe('opening');
  });

  it('acquire returns false when someone else active', () => {
    const { result } = renderHook(() => useRewriteMutex(), { wrapper });
    act(() => { result.current.acquire('opening'); });
    let ok = true;
    act(() => { ok = result.current.acquire('closing'); });
    expect(ok).toBe(false);
    expect(result.current.activeKey).toBe('opening');
  });

  it('same key re-acquire returns true (idempotent)', () => {
    const { result } = renderHook(() => useRewriteMutex(), { wrapper });
    act(() => { result.current.acquire('opening'); });
    let ok = false;
    act(() => { ok = result.current.acquire('opening'); });
    expect(ok).toBe(true);
  });

  it('release clears activeKey only when matching', () => {
    const { result } = renderHook(() => useRewriteMutex(), { wrapper });
    act(() => { result.current.acquire('opening'); });
    act(() => { result.current.release('closing'); });
    expect(result.current.activeKey).toBe('opening');
    act(() => { result.current.release('opening'); });
    expect(result.current.activeKey).toBeNull();
  });

  it('after release, another key can acquire', () => {
    const { result } = renderHook(() => useRewriteMutex(), { wrapper });
    act(() => { result.current.acquire('opening'); });
    act(() => { result.current.release('opening'); });
    let ok = false;
    act(() => { ok = result.current.acquire('closing'); });
    expect(ok).toBe(true);
    expect(result.current.activeKey).toBe('closing');
  });
});
