"use client";

// Tengasell DISC-04: Product Comparison Dialog
// Modal comparing up to 3 products side-by-side with truthful value states:
// KNOWN, UNKNOWN, CONFLICTED, REDACTED, NOT_APPLICABLE.
// Respects PI privacy (no VIN/chassis/reg/engine numbers) and category scoping.

import { useEffect, useState } from "react";
import { AlertCircle, Check, HelpCircle, Lock, Minus, ShieldAlert, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/tengasell/api";
import type { ComparisonValueState, ProductComparisonResponse } from "@/lib/tengasell/types";
import { cn } from "@/lib/utils";

export function CompareDialog({
  open,
  onOpenChange,
  auctionIds,
  onRemoveItem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  auctionIds: number[];
  onRemoveItem: (id: number) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProductComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || auctionIds.length === 0) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .compareProducts(auctionIds)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "Could not load comparison.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, auctionIds]);

  const renderCellStatus = (state: ComparisonValueState, displayVal: string) => {
    switch (state) {
      case "KNOWN":
        return <span className="text-body font-semibold text-foreground break-words">{displayVal}</span>;
      case "UNKNOWN":
        return (
          <span className="inline-flex items-center gap-1 text-caption text-muted-foreground italic">
            <Minus className="size-3" />
            Unknown
          </span>
        );
      case "CONFLICTED":
        return (
          <span className="inline-flex items-center gap-1 text-caption font-bold text-warn bg-warn/10 px-2 py-0.5 rounded-pill">
            <AlertCircle className="size-3" />
            Conflicted
          </span>
        );
      case "REDACTED":
        return (
          <span className="inline-flex items-center gap-1 text-caption font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-pill">
            <Lock className="size-3" />
            Redacted
          </span>
        );
      case "NOT_APPLICABLE":
      default:
        return (
          <span className="inline-flex items-center gap-1 text-caption text-muted-foreground/60">
            <HelpCircle className="size-3" />
            N/A
          </span>
        );
    }
  };

  const scopeBadge = (scope?: string) => {
    switch (scope) {
      case "SAME_LEAF":
        return (
          <Badge variant="outline" className="border-teal/40 text-teal bg-teal/10">
            Full Specification Comparison
          </Badge>
        );
      case "RELATED_FAMILY":
        return (
          <Badge variant="outline" className="border-gold/40 text-gold bg-gold/10">
            Shared Family Attributes
          </Badge>
        );
      case "UNRELATED":
      default:
        return (
          <Badge variant="outline" className="border-muted text-muted-foreground">
            Universal Commercial Attributes
          </Badge>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="shrink-0 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="text-headline font-bold text-foreground">
                Product Comparison
              </DialogTitle>
              <DialogDescription className="text-caption text-muted-foreground mt-0.5">
                Compare verified product intelligence attributes, provenance, and commercial terms.
              </DialogDescription>
            </div>
            {data && <div>{scopeBadge(data.scope)}</div>}
          </div>
        </DialogHeader>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <div className="size-8 rounded-full border-2 border-teal border-t-transparent animate-spin" />
            <p className="text-caption font-medium">Gathering product intelligence facts…</p>
          </div>
        ) : error ? (
          <div className="py-12 text-center space-y-3">
            <ShieldAlert className="size-8 text-danger mx-auto" />
            <p className="text-body font-bold text-foreground">Comparison Unavailable</p>
            <p className="text-caption text-muted-foreground max-w-md mx-auto">{error}</p>
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <p className="text-body">Select at least 1 item to inspect or up to 3 to compare.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto ts-scrollbar pr-1 -mr-1 space-y-6">
            {/* Header Product Cards */}
            <div
              className={cn(
                "grid gap-4 sticky top-0 bg-background/95 backdrop-blur z-10 pb-4 border-b border-border",
                data.items.length === 1 && "grid-cols-[140px_1fr]",
                data.items.length === 2 && "grid-cols-[140px_1fr_1fr]",
                data.items.length === 3 && "grid-cols-[140px_1fr_1fr_1fr]",
              )}
            >
              <div className="flex items-end pb-2">
                <span className="text-caption font-bold text-muted-foreground uppercase tracking-wider">
                  Product Lot
                </span>
              </div>
              {data.items.map((item) => (
                <div
                  key={item.auctionId}
                  className="rounded-card border border-border bg-raised p-3 relative flex flex-col gap-2 shadow-xs"
                >
                  <button
                    type="button"
                    onClick={() => onRemoveItem(item.auctionId)}
                    className="absolute top-2 right-2 p-1 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    aria-label={`Remove lot ${item.auctionId} from comparison`}
                  >
                    <X className="size-3.5" />
                  </button>
                  <div className="aspect-video w-full rounded-input overflow-hidden bg-muted">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                        No photo
                      </div>
                    )}
                  </div>
                  <div>
                    <a
                      href={`#/item/${item.auctionId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-label font-bold text-foreground line-clamp-2 hover:text-teal transition-colors"
                    >
                      {item.title}
                    </a>
                    <p className="text-caption font-semibold text-teal mt-0.5">
                      US${item.currentPrice.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {item.location || "Zimbabwe"} · {item.categoryTitle}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Comparison Sections */}
            <div className="space-y-6">
              {data.sections.map((sec) => (
                <div key={sec.name} className="space-y-2">
                  <h4 className="text-label font-bold text-foreground px-1 border-b border-border/60 pb-1">
                    {sec.name}
                  </h4>
                  <div className="divide-y divide-border/40">
                    {sec.rows.map((row) => (
                      <div
                        key={row.key}
                        className={cn(
                          "grid gap-4 py-2.5 px-1 items-center hover:bg-accent/40 rounded transition-colors",
                          data.items.length === 1 && "grid-cols-[140px_1fr]",
                          data.items.length === 2 && "grid-cols-[140px_1fr_1fr]",
                          data.items.length === 3 && "grid-cols-[140px_1fr_1fr_1fr]",
                        )}
                      >
                        <div className="text-caption font-medium text-muted-foreground">
                          {row.label}
                        </div>
                        {row.cells.map((cell) => (
                          <div key={cell.auctionId} className="text-body min-w-0">
                            {renderCellStatus(cell.status, cell.displayValue)}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
