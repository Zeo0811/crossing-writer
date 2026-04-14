import { PixelIcon, type PixelIconProps } from "./Icon";
export function WikiIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="3" y="2" width="10" height="12" />
      <rect x="5" y="4" width="6" height="1" fill="var(--bg-1)" />
      <rect x="5" y="7" width="6" height="1" fill="var(--bg-1)" />
      <rect x="5" y="10" width="4" height="1" fill="var(--bg-1)" />
    </PixelIcon>
  );
}
