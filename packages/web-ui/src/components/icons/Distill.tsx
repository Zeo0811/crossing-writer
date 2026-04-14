import { PixelIcon, type PixelIconProps } from "./Icon";
export function DistillIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="2" y="2" width="12" height="2" />
      <rect x="3" y="4" width="10" height="2" />
      <rect x="5" y="6" width="6" height="2" />
      <rect x="7" y="8" width="2" height="6" />
    </PixelIcon>
  );
}
