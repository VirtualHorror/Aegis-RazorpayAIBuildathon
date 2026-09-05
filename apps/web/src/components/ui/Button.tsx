import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50";
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:brightness-110",
  secondary: "border border-border bg-surface text-fg hover:bg-surface-2",
  ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
};
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3 text-sm",
};

export function buttonClassName(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className = ""): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

/** `forwardRef` so a dialog can move focus to its confirm button. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, children, className = "", type = "button", disabled, ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClassName(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Icon name="loader" className="spin" /> : icon}
      {children}
    </button>
  );
});

export interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  prefetch?: boolean;
}

export function ButtonLink({ href, variant = "secondary", size = "md", icon, children, className = "", prefetch }: ButtonLinkProps) {
  return (
    <Link href={href} prefetch={prefetch} className={buttonClassName(variant, size, className)}>
      {icon}
      {children}
    </Link>
  );
}
