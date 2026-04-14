import type { HTMLAttributes } from "react";

type Variant = "section" | "agent" | "panel";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  halftone?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  section: "bg-bg-1 border border-hair rounded-[6px] px-6 py-[22px] relative",
  agent:
    "bg-bg-2 border border-hair border-l-2 border-l-accent rounded-[6px] p-[18px] flex flex-col gap-3 relative",
  panel: "bg-bg-2 border-0 rounded-[6px] p-[18px] relative",
};

export function Card({
  variant = "section",
  halftone = false,
  className = "",
  children,
  ...rest
}: CardProps) {
  return (
    <div className={`${VARIANTS[variant]} ${className}`.trim()} {...rest}>
      {halftone && (
        <div
          data-halftone=""
          aria-hidden
          className="absolute top-[10px] right-3 w-[34px] h-[14px] opacity-45 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(var(--hair-strong) 1px, transparent 1px)",
            backgroundSize: "4px 4px",
          }}
        />
      )}
      {children}
    </div>
  );
}
