import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const base =
  "font-sans text-[13px] font-medium tracking-[0.02em] px-[14px] py-[7px] rounded-[2px] border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent border-accent text-accent-on font-semibold hover:bg-accent-soft hover:border-accent-soft",
  secondary:
    "bg-bg-2 border-hair text-body hover:border-accent hover:text-accent",
  ghost:
    "bg-transparent border-hair text-meta hover:text-body hover:border-hair-strong",
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${base} ${VARIANTS[variant]} ${className}`.trim()}
      {...rest}
    />
  );
}
