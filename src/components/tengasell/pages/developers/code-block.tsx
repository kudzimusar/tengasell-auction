"use client";

// Tengasell — styled code block for the developers page.
// Teal-tinted, mono, horizontal scroll, one-tap copy (clipboard + toast).

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function CodeBlock({
  code,
  label = "shell",
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast({ title: "Copied to clipboard", description: label });
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({
        title: "Could not copy",
        description: "Your browser blocked clipboard access — select the text manually.",
        variant: "destructive",
      });
    }
  }

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-control border border-teal/25 bg-teal-tint/50",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-teal/15 py-0.5 pe-1 ps-3">
        <figcaption className="font-mono text-caption font-semibold text-teal-deep">
          {label}
        </figcaption>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Copy ${label} snippet to clipboard`}
          className="grid size-11 place-items-center rounded-control text-teal-deep transition-colors hover:bg-teal/10 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <pre className="ts-scrollbar overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-foreground/90">
        {code}
      </pre>
    </figure>
  );
}
