"use client";

// Tengasell — architecture diagram for the developers page.
// Pure HTML/CSS: styled divs + arrows drawn with CSS borders.
// Responsive: vertical flow on mobile, horizontal fan-out on desktop.

import { Database, Globe, Network, Sparkles, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const SERVICES: { icon: LucideIcon; name: string; port: string; lines: string[] }[] = [
  {
    icon: Database,
    name: "TrailBase",
    port: ":3001",
    lines: ["Rust · records REST, auth", "SSE subscribe", "admin UI /_/admin"],
  },
  {
    icon: Zap,
    name: "Trade engine",
    port: ":3002",
    lines: ["socket.io RPC", "bids, chat, orders", "proxy bidding + anti-snipe"],
  },
  {
    icon: Sparkles,
    name: "Assistant API",
    port: "/api/assistant",
    lines: ["LLM trade copilot", "server-side only"],
  },
];

export function Architecture() {
  return (
    <div className="rounded-card border border-border bg-raised p-4 sm:p-6">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-0">
        <Node
          icon={Globe}
          name="Browser SPA"
          port=":3000"
          lines={["Next.js · hash-router SPA", "renders this site"]}
          className="lg:flex-1"
        />

        <FlowArrow />

        <Node
          icon={Network}
          name="Gateway"
          port="?XTransformPort"
          lines={["one external port", "routes REST + WebSocket"]}
          className="lg:flex-1"
        />

        <FlowArrow />

        {/* fan-out to the three backing services */}
        <div className="relative flex min-w-0 flex-col gap-2 lg:flex-[1.3] lg:ps-5">
          <span
            aria-hidden="true"
            className="absolute inset-y-4 start-0 hidden w-0.5 rounded-full bg-teal-soft/50 lg:block"
          />
          {SERVICES.map((s) => (
            <div key={s.name} className="relative">
              <span
                aria-hidden="true"
                className="absolute -start-5 top-1/2 hidden h-0.5 w-5 -translate-y-1/2 rounded-full bg-teal-soft/50 lg:block"
              />
              <Node icon={s.icon} name={s.name} port={s.port} lines={s.lines} />
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-caption leading-relaxed text-muted-foreground">
        All browser traffic funnels through the gateway — the SPA appends{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-caption">
          ?XTransformPort=3001
        </code>{" "}
        to records/auth calls and connects the trade socket as{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-caption">
          io(&quot;/?XTransformPort=3002&quot;)
        </code>
        . No service port ever appears in a URL host.
      </p>
    </div>
  );
}

// ── node box ────────────────────────────────────────────────────────

function Node({
  icon: Icon,
  name,
  port,
  lines,
  className,
}: {
  icon: LucideIcon;
  name: string;
  port: string;
  lines: string[];
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-card border border-border bg-section p-3.5", className)}>
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-teal-tint text-teal">
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-label font-bold text-foreground">{name}</span>
          <span className="block text-caption leading-snug text-muted-foreground">
            {lines.join(" · ")}
          </span>
        </span>
        <code className="shrink-0 rounded bg-teal-tint px-1.5 py-0.5 font-mono text-caption font-semibold text-teal-deep">
          {port}
        </code>
      </div>
    </div>
  );
}

// ── arrow (CSS borders) ─────────────────────────────────────────────

function FlowArrow() {
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center py-0.5 lg:px-2">
      {/* mobile: down arrow */}
      <span className="relative block h-7 w-0.5 rounded-full bg-teal-soft/70 lg:hidden">
        <span className="absolute -bottom-1 left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] border-b-2 border-r-2 border-teal-soft" />
      </span>
      {/* desktop: right arrow */}
      <span className="relative hidden h-0.5 w-9 rounded-full bg-teal-soft/70 lg:block">
        <span className="absolute -end-1 top-1/2 size-2.5 -translate-y-1/2 rotate-45 rounded-[2px] border-t-2 border-r-2 border-teal-soft" />
      </span>
    </span>
  );
}
