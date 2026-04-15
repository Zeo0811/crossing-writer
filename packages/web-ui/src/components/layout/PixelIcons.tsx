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

export function IconProjects(p: IconProps) {
  return (
    <PixelSvg {...p}>
      <rect x="0" y="2" width="2" height="2" />
      <rect x="2" y="2" width="2" height="2" />
      <rect x="4" y="2" width="2" height="2" />
      <rect x="0" y="4" width="12" height="2" />
      <rect x="0" y="6" width="2" height="4" />
      <rect x="10" y="6" width="2" height="4" />
      <rect x="0" y="10" width="12" height="2" />
    </PixelSvg>
  );
}

export function IconKnowledge(p: IconProps) {
  return (
    <PixelSvg {...p}>
      <rect x="0" y="1" width="12" height="2" />
      <rect x="0" y="5" width="8" height="2" />
      <rect x="0" y="9" width="10" height="2" />
    </PixelSvg>
  );
}

export function IconStyle(p: IconProps) {
  return (
    <PixelSvg {...p}>
      <rect x="9" y="0" width="3" height="2" />
      <rect x="7" y="2" width="3" height="2" />
      <rect x="5" y="4" width="3" height="2" />
      <rect x="3" y="6" width="3" height="2" />
      <rect x="1" y="8" width="3" height="2" />
      <rect x="0" y="10" width="2" height="2" />
    </PixelSvg>
  );
}

export function IconConfig(p: IconProps) {
  return (
    <PixelSvg {...p}>
      <rect x="5" y="0" width="2" height="2" />
      <rect x="5" y="10" width="2" height="2" />
      <rect x="0" y="5" width="2" height="2" />
      <rect x="10" y="5" width="2" height="2" />
      <rect x="1" y="1" width="2" height="2" />
      <rect x="9" y="1" width="2" height="2" />
      <rect x="1" y="9" width="2" height="2" />
      <rect x="9" y="9" width="2" height="2" />
      <rect x="3" y="3" width="6" height="6" />
      <rect x="5" y="5" width="2" height="2" fill="var(--bg-1)" />
    </PixelSvg>
  );
}

export function IconSettings(p: IconProps) {
  return (
    <PixelSvg {...p}>
      <rect x="0" y="2" width="12" height="1" />
      <rect x="3" y="1" width="2" height="3" />
      <rect x="0" y="6" width="12" height="1" />
      <rect x="8" y="5" width="2" height="3" />
      <rect x="0" y="10" width="12" height="1" />
      <rect x="5" y="9" width="2" height="3" />
    </PixelSvg>
  );
}

export function PixelEmptyArt({ size = 96 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      aria-hidden
    >
      <rect x="2" y="6" width="10" height="2" fill="var(--accent-soft)" />
      <rect x="2" y="8" width="28" height="2" fill="var(--accent)" />
      <rect x="2" y="10" width="2" height="16" fill="var(--accent-soft)" />
      <rect x="28" y="10" width="2" height="16" fill="var(--accent-soft)" />
      <rect x="2" y="24" width="28" height="2" fill="var(--accent-soft)" />
      <rect x="4" y="10" width="24" height="14" fill="var(--accent-fill)" />
      <rect x="14" y="13" width="4" height="8" fill="var(--accent)" />
      <rect x="12" y="15" width="8" height="4" fill="var(--accent)" />
      <rect x="22" y="12" width="2" height="2" fill="var(--pink)" />
      <rect x="24" y="14" width="2" height="2" fill="var(--pink)" />
      <rect x="6" y="20" width="2" height="2" fill="var(--amber)" />
    </svg>
  );
}
