import { useEffect, useState } from 'react';

export interface PixelLoaderProps {
  label?: string;
  /** 0-100 optional; if omitted shows indeterminate dots */
  progress?: number;
  /** grid size, default 5 (5x5 = 25 pixels) */
  size?: number;
}

/**
 * 像素风加载占位：N×N 方格，按"从左上到右下"的对角波纹依次亮起，
 * 形成一种 8-bit 扫描的动态感。完成前一直动画，指示后台在加载。
 */
export function PixelLoader({ label = '载入中', progress, size = 5 }: PixelLoaderProps) {
  const total = size * size;
  const cells = Array.from({ length: total });
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (progress !== undefined) return;
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '·'));
    }, 450);
    return () => clearInterval(id);
  }, [progress]);

  return (
    <div
      role="status"
      aria-label={label}
      className="flex flex-col items-center justify-center gap-5 py-16 select-none"
    >
      <div
        className="grid gap-[3px] pixel-loader-grid"
        style={{ gridTemplateColumns: `repeat(${size}, 10px)` }}
      >
        {cells.map((_, i) => {
          const row = Math.floor(i / size);
          const col = i % size;
          const delay = (row + col) * 0.08;
          return (
            <span
              key={i}
              className="pixel-loader-cell"
              style={{ animationDelay: `${delay}s` }}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--meta)] tracking-wide">{label}</span>
        {progress === undefined ? (
          <span
            className="text-xs text-[var(--accent)] tabular-nums w-4 text-left"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {dots}
          </span>
        ) : (
          <span
            className="text-xs text-[var(--accent)] tabular-nums"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {Math.round(progress)}%
          </span>
        )}
      </div>
    </div>
  );
}
