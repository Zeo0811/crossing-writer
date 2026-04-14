import { PixelIcon, type PixelIconProps } from "./Icon";
export function ConfigIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="6" y="1" width="4" height="2" />
      <rect x="6" y="13" width="4" height="2" />
      <rect x="1" y="6" width="2" height="4" />
      <rect x="13" y="6" width="2" height="4" />
      <rect x="4" y="4" width="8" height="8" />
      <rect x="6" y="6" width="4" height="4" fill="var(--bg-1)" />
    </PixelIcon>
  );
}
