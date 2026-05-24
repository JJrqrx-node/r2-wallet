import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  mono?: boolean;
}

export function Input({
  label,
  error,
  mono = false,
  className = "",
  id,
  ...props
}: InputProps) {
  return (
    <div className="field">
      {label ? <label htmlFor={id}>{label}</label> : null}
      <input
        id={id}
        className={`input ${mono ? "input-mono" : ""} ${className}`}
        {...props}
      />
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
