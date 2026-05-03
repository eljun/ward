import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-55",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--button)] text-white shadow-[var(--shadow-button)] hover:bg-[var(--button-hover)]",
        secondary: "border-[var(--border)] bg-white/60 text-[var(--ink)] shadow-sm hover:bg-white/80",
        ghost: "border-transparent bg-transparent text-[var(--ink)] shadow-none hover:bg-white/50",
        tab: "border-[var(--border)] bg-white/55 text-[var(--ink)] shadow-[var(--shadow-soft)] hover:bg-white/75",
        tabActive: "border-[var(--accent-border)] bg-[linear-gradient(135deg,rgba(20,32,40,0.98),rgba(30,52,56,0.96))] text-white shadow-[var(--shadow-button)]"
      },
      size: {
        default: "px-4 py-2",
        sm: "min-h-9 px-3 py-1.5",
        lg: "min-h-12 px-5 py-3",
        icon: "size-10 p-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
