import { PixelIcon, type PixelIconProps } from "./Icon";
export function StyleIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="10" y="2" width="4" height="4" />
      <rect x="8" y="4" width="4" height="4" />
      <rect x="6" y="6" width="4" height="4" />
      <rect x="2" y="10" width="6" height="4" />
    </PixelIcon>
  );
}
