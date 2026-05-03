import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none",
  {
    variants: {
      tone: {
        default: "border-[var(--border)] bg-white/55 text-[var(--muted)]",
        success: "border-emerald-200 bg-emerald-50/80 text-emerald-800",
        warning: "border-amber-200 bg-amber-50/80 text-amber-800",
        danger: "border-rose-200 bg-rose-50/80 text-rose-800",
        active: "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
      }
    },
    defaultVariants: {
      tone: "default"
    }
  }
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
