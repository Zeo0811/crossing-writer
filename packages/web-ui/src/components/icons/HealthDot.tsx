import { PixelIcon, type PixelIconProps } from "./Icon";
export function HealthDotIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="5" y="5" width="6" height="6" />
      <rect x="4" y="6" width="1" height="4" />
      <rect x="11" y="6" width="1" height="4" />
      <rect x="6" y="4" width="4" height="1" />
      <rect x="6" y="11" width="4" height="1" />
    </PixelIcon>
  );
}
