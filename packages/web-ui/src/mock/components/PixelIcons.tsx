import type { SVGProps } from "react";

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function PixelSvg({ size = 14, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

// pixel folder (项目) — 2x2 cells, visible staircase tab
export function IconProjects(p: IconProps) {
  return (
    <PixelSvg {...p}>
      {/* tab */}
      <rect x="0" y="2" width="2" height="2" />
      <rect x="2" y="2" width="2" height="2" />
      <rect x="4" y="2" width="2" height="2" />
      {/* top edge */}
      <rect x="0" y="4" width="12" height="2" />
      {/* sides */}
      <rect x="0" y="6" width="2" height="4" />
      <rect x="10" y="6" width="2" height="4" />
      {/* bottom edge */}
      <rect x="0" y="10" width="12" height="2" />
    </PixelSvg>
  );
}

// pixel text lines (知识库) — three staggered "text" rows
export function IconKnowledge(p: IconProps) {
  return (
    <PixelSvg {...p}>
      {/* line 1 (top, full width) */}
      <rect x="0" y="1" width="12" height="2" />
      {/* line 2 (middle, shorter) */}
      <rect x="0" y="5" width="8" height="2" />
      {/* line 3 (bottom, mid length) */}
      <rect x="0" y="9" width="10" height="2" />
    </PixelSvg>
  );
}

// pen nib (风格)
export function IconStyle(p: IconProps) {
  return (
    <PixelSvg {...p}>
      {/* diagonal pen body */}
      <rect x="9" y="0" width="3" height="2" />
      <rect x="7" y="2" width="3" height="2" />
      <rect x="5" y="4" width="3" height="2" />
      <rect x="3" y="6" width="3" height="2" />
      {/* nib tip */}
      <rect x="1" y="8" width="3" height="2" />
      <rect x="0" y="10" width="2" height="2" />
    </PixelSvg>
  );
}

// gear (配置)
export function IconConfig(p: IconProps) {
  return (
    <PixelSvg {...p}>
      {/* nubs N S E W */}
      <rect x="5" y="0" width="2" height="2" />
      <rect x="5" y="10" width="2" height="2" />
      <rect x="0" y="5" width="2" height="2" />
      <rect x="10" y="5" width="2" height="2" />
      {/* corner nubs */}
      <rect x="1" y="1" width="2" height="2" />
      <rect x="9" y="1" width="2" height="2" />
      <rect x="1" y="9" width="2" height="2" />
      <rect x="9" y="9" width="2" height="2" />
      {/* body ring */}
      <rect x="3" y="3" width="6" height="6" />
      {/* hub hole */}
      <rect x="5" y="5" width="2" height="2" fill="var(--bg-1)" />
    </PixelSvg>
  );
}

// horizontal sliders (设置)
export function IconSettings(p: IconProps) {
  return (
    <PixelSvg {...p}>
      {/* track 1 */}
      <rect x="0" y="2" width="12" height="1" />
      <rect x="3" y="1" width="2" height="3" />
      {/* track 2 */}
      <rect x="0" y="6" width="12" height="1" />
      <rect x="8" y="5" width="2" height="3" />
      {/* track 3 */}
      <rect x="0" y="10" width="12" height="1" />
      <rect x="5" y="9" width="2" height="3" />
    </PixelSvg>
  );
}

// big empty-state illustration: pixel folder with "+" overlay
export function PixelEmptyArt({ size = 96 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      aria-hidden
    >
      {/* folder tab */}
      <rect x="2" y="6" width="10" height="2" fill="var(--accent-soft)" />
      {/* top edge */}
      <rect x="2" y="8" width="28" height="2" fill="var(--accent)" />
      {/* sides */}
      <rect x="2" y="10" width="2" height="16" fill="var(--accent-soft)" />
      <rect x="28" y="10" width="2" height="16" fill="var(--accent-soft)" />
      {/* bottom */}
      <rect x="2" y="24" width="28" height="2" fill="var(--accent-soft)" />
      {/* inner shading */}
      <rect x="4" y="10" width="24" height="14" fill="var(--accent-fill)" />
      {/* plus sign */}
      <rect x="14" y="13" width="4" height="8" fill="var(--accent)" />
      <rect x="12" y="15" width="8" height="4" fill="var(--accent)" />
      {/* sparkle 1 */}
      <rect x="22" y="12" width="2" height="2" fill="var(--pink)" />
      <rect x="24" y="14" width="2" height="2" fill="var(--pink)" />
      {/* sparkle 2 */}
      <rect x="6" y="20" width="2" height="2" fill="var(--amber)" />
    </svg>
  );
}

// brand: 十字 (crossroad)
export function IconCrossing(p: IconProps) {
  return (
    <PixelSvg {...p}>
      {/* horizontal bar */}
      <rect x="0" y="5" width="12" height="2" />
      {/* vertical bar */}
      <rect x="5" y="0" width="2" height="12" />
    </PixelSvg>
  );
}
