import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export function Card({ title, children, className = "", ...props }: CardProps) {
  return (
    <div className={`card ${className}`} {...props}>
      {title ? <p className="card-title">{title}</p> : null}
      {children}
    </div>
  );
}
