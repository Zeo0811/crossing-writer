import { PixelIcon, type PixelIconProps } from "./Icon";
export function ToolIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="2" y="2" width="3" height="3" />
      <rect x="3" y="3" width="1" height="1" fill="var(--bg-1)" />
      <rect x="4" y="5" width="8" height="2" />
      <rect x="11" y="11" width="3" height="3" />
      <rect x="12" y="12" width="1" height="1" fill="var(--bg-1)" />
      <rect x="6" y="7" width="6" height="2" />
    </PixelIcon>
  );
}
