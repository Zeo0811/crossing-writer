import { PixelIcon, type PixelIconProps } from "./Icon";
export function SpriteIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p} style={{ color: "var(--pink)" }}>
      <rect x="3" y="2" width="10" height="10" rx="1" />
      <rect x="5" y="4" width="2" height="2" fill="var(--bg-1)" />
      <rect x="9" y="4" width="2" height="2" fill="var(--bg-1)" />
      <rect x="3" y="9" width="10" height="3" fill="var(--pink-shadow)" />
    </PixelIcon>
  );
}
