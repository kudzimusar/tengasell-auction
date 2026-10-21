"use client";

// Home module shared link button — hash-router anchor with NXS press
// feedback: 44px touch targets, reduced-motion aware, keyboard focus rings.

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { useLinkProps } from "@/lib/tengasell/router";
import { cn } from "@/lib/utils";

type Variant = "primary" | "gold" | "outline" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-teal text-white hover:bg-teal-deep",
  gold: "bg-gold text-gold-on hover:bg-gold-deep",
  outline: "border border-white/45 text-white hover:bg-white/15 backdrop-blur-sm",
  ghost: "text-teal hover:bg-accent/60",
};

export function LinkButton({
  to,
  children,
  variant = "primary",
  className,
  ariaLabel,
}: {
  to: string;
  children: ReactNode;
  variant?: Variant;
  className?: string;
  ariaLabel?: string;
}) {
  const link = useLinkProps(to);
  const reduced = useReducedMotion();
  return (
    <motion.a
      {...link}
      aria-label={ariaLabel}
      whileTap={reduced ? undefined : { scale: 0.98 }}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 min-h-11 px-5 rounded-control text-label font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </motion.a>
  );
}
