import type { InputHTMLAttributes } from "react";
import { useId } from "react";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export function Checkbox({ label, id, className = "", ...rest }: CheckboxProps) {
  const fallback = useId();
  const ctrlId = id ?? fallback;
  return (
    <span className={`inline-flex items-center gap-2 text-[13px] text-body ${className}`.trim()}>
      <input
        id={ctrlId}
        type="checkbox"
        className="appearance-none w-[14px] h-[14px] bg-bg-2 border border-hair rounded-[2px] checked:bg-accent checked:border-accent cursor-pointer relative checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:text-accent-on checked:after:text-[10px] checked:after:leading-[12px] checked:after:text-center checked:after:font-pixel"
        {...rest}
      />
      {label && <label htmlFor={ctrlId}>{label}</label>}
    </span>
  );
}
