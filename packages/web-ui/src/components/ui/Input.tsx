import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`bg-bg-2 border border-hair rounded-[2px] px-3 py-[7px] text-[13px] text-body font-sans placeholder:text-faint focus:outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--accent-dim)] transition-colors ${className}`.trim()}
      {...rest}
    />
  );
}
