import { PixelIcon, type PixelIconProps } from "./Icon";
export function AgentIcon(p: PixelIconProps) {
  return (
    <PixelIcon {...p}>
      <rect x="6" y="2" width="4" height="2" />
      <rect x="5" y="4" width="6" height="4" />
      <rect x="6" y="5" width="1" height="1" fill="var(--bg-1)" />
      <rect x="9" y="5" width="1" height="1" fill="var(--bg-1)" />
      <rect x="4" y="9" width="8" height="5" />
      <rect x="3" y="11" width="1" height="3" />
      <rect x="12" y="11" width="1" height="3" />
    </PixelIcon>
  );
}
