import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export interface RewriteMutex {
  activeKey: string | null;
  acquire(key: string): boolean;
  release(key: string): void;
}

const RewriteMutexContext = createContext<RewriteMutex | null>(null);

export function RewriteMutexProvider({ children }: { children: ReactNode }) {
  const activeRef = useRef<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const acquire = useCallback((key: string): boolean => {
    if (activeRef.current !== null && activeRef.current !== key) {
      return false;
    }
    activeRef.current = key;
    setActiveKey(key);
    return true;
  }, []);

  const release = useCallback((key: string): void => {
    if (activeRef.current === key) {
      activeRef.current = null;
      setActiveKey(null);
    }
  }, []);

  return (
    <RewriteMutexContext.Provider value={{ activeKey, acquire, release }}>
      {children}
    </RewriteMutexContext.Provider>
  );
}

export function useRewriteMutex(): RewriteMutex {
  const ctx = useContext(RewriteMutexContext);
  if (!ctx) {
    throw new Error('useRewriteMutex must be used within RewriteMutexProvider');
  }
  return ctx;
}
