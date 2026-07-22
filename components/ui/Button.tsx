"use client";

import { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "quiet";
}

export default function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  const styles = {
    primary:
      "bg-eucalyptus text-white hover:bg-deep-eucalyptus",

    secondary:
      "border border-sea-glass bg-enamel text-graphite hover:bg-porcelain",

    danger:
      "bg-clay text-white hover:bg-clay/90",
    quiet:
      "bg-transparent text-eucalyptus hover:bg-sea-glass/60",
  };

  return (
    <button
      {...props}
      className={`
        inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold
        transition-colors
        disabled:opacity-50
        disabled:cursor-not-allowed
        ${styles[variant]}
        ${className}
      `}
    >
      {children}
    </button>
  );
}
