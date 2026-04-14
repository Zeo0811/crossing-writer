import type { SVGProps, ReactNode } from "react";

export interface PixelIconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
  children?: ReactNode;
}

export function PixelIcon({ size = 16, children, ...rest }: PixelIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      fill="currentColor"
      {...rest}
    >
      {children}
    </svg>
  );
}
