"use client";

// Tengasell — Dispute button (order detail, buyer, 7-day window). Task 12-c.
// Dialog intake → POST /api/trust/me/disputes {order_id, reason_code, note,
// order: snapshot} — the service creates the urgent ticket + dispute case and
// records the order snapshot as case evidence. When a dispute already exists
// for the order the trigger becomes a read-only status chip.

import { useState } from "react";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/tengasell/auth";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatRelative } from "@/lib/tengasell/format";
import type { Order } from "@/lib/tengasell/types";
import {
  trustFetch,
  TrustChip,
  useTrustLabels,
  type DisputeRow,
} from "../trust-client";

const REASONS = ["not_received", "not_as_described", "damaged", "seller_unresponsive"] as const;

const WINDOW_MS = 7 * 86_400_000;

export function DisputeButton({ order }: { order: Order }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const labels = useTrustLabels();

  const disputable = order.status === "delivered" || order.status === "completed";

  const existing = useResource<DisputeRow[]>(
    async () => {
      if (!user || !disputable) return [];
      try {
        const d = await trustFetch<{ disputes: DisputeRow[] }>(
          user.token,
          `/me/disputes?order_id=${order.id}`,
        );
        return d.disputes ?? [];
      } catch {
        return [];
      }
    },
    [user?.token, order.id, disputable],
  );

  if (!user || !disputable) return null;

  const rows = existing.data ?? [];
  const open = rows[0];

  if (existing.loading) {
    return <Skeleton className="h-11 w-full rounded-control" />;
  }

  if (open) {
    const chip = labels.caseStatus(open.status);
    return (
      <div className="rounded-card border border-border bg-raised p-4">
        <p className="text-label font-bold text-foreground flex items-center gap-2">
          <AlertTriangle className="size-4 text-warn" aria-hidden="true" />
          {t("disputes.existing")}
        </p>
        <p className="text-caption text-muted-foreground mt-1">
          #{open.id} · {open.subject}
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <TrustChip tone={chip.tone}>{chip.label}</TrustChip>
          <span className="text-caption text-muted-foreground">
            {formatRelative(open.created_at)}
          </span>
        </div>
      </div>
    );
  }

  return <DisputeDialog order={order} token={user.token} />;
}

function DisputeDialog({ order, token }: { order: Order; token: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("not_received");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const windowLeftMs = order.delivered_at
    ? Date.parse(order.delivered_at) + WINDOW_MS - Date.now()
    : null;
  const inWindow = windowLeftMs != null && windowLeftMs > 0;

  const valid = note.trim().length >= 10;

  const submit = async () => {
    setBusy(true);
    try {
      await trustFetch(token, "/me/disputes", {
        method: "POST",
        body: JSON.stringify({
          order_id: order.id,
          reason_code: reason,
          note,
          // order snapshot recorded in the case evidence (v1: the 7-day
          // window is checked client-side, the reviewer re-checks).
          order: {
            id: order.id,
            auction_id: order.auction_id,
            auction_title: order.auction_title,
            seller_username: order.seller_username,
            buyer_username: order.buyer_username,
            order_status: order.status,
            delivered_at: order.delivered_at,
            final_price: order.final_price,
          },
        }),
      });
      toast({ title: t("disputes.toast") });
      setDone(true);
      setOpen(false);
    } catch (err) {
      toast({
        title: t("disputes.failed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-card border border-gold/40 bg-gold-soft/50 p-4">
        <p className="text-label font-bold text-foreground">{t("disputes.submittedTitle")}</p>
        <p className="text-caption text-muted-foreground mt-1">{t("disputes.submittedBody")}</p>
      </div>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 rounded-control w-full"
        aria-label={t("disputes.trigger")}
        onClick={() => setOpen(true)}
      >
        <AlertTriangle className="size-4" aria-hidden="true" />
        <span className="truncate">{t("disputes.trigger")}</span>
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("disputes.title")}</DialogTitle>
            <DialogDescription>
              {t("disputes.sub")} “{order.auction_title}”
              {order.delivered_at
                ? ` · ${t("disputes.delivered")} ${formatRelative(order.delivered_at)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="dispute-reason">{t("disputes.reason")}</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="dispute-reason" className="min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`disputes.reason.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dispute-note">{t("disputes.note")}</Label>
              <Textarea
                id="dispute-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-28"
                placeholder={t("disputes.notePlaceholder")}
              />
            </div>
            <p
              className={`text-caption rounded-control border p-3 ${
                inWindow
                  ? "border-teal/30 bg-teal-tint/50 text-teal-deep"
                  : "border-warn/40 bg-warn/10 text-warn"
              }`}
            >
              {inWindow ? t("disputes.windowIn") : t("disputes.windowOut")}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>
              {t("action.cancel")}
            </Button>
            <Button type="button" className="min-h-11" disabled={busy || !valid} onClick={() => void submit()}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              {t("disputes.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
