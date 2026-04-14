import type { SelectHTMLAttributes } from "react";

export function Select({
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`bg-bg-2 border border-hair rounded-[2px] px-3 py-[7px] text-[13px] text-body font-sans focus:outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--accent-dim)] transition-colors ${className}`.trim()}
      {...rest}
    >
      {children}
    </select>
  );
}
