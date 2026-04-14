import { PixelIcon, type PixelIconProps } from "./Icon";
export function RawIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="3" y="2" width="8" height="12" />
      <rect x="11" y="2" width="2" height="2" />
      <rect x="5" y="5" width="6" height="1" fill="var(--bg-1)" />
      <rect x="5" y="7" width="6" height="1" fill="var(--bg-1)" />
      <rect x="5" y="9" width="4" height="1" fill="var(--bg-1)" />
    </PixelIcon>
  );
}
