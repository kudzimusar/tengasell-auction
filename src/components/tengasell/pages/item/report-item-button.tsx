"use client";

// Tengasell — Report item button (item page action row). Task 12-c.
// Popover intake for abuse reports (TNS-001): reason radio + evidence note →
// POST /api/trust/me/reports. Signed-out users get a disabled trigger with a
// sign-in hint (reports need an accountable reporter).

import { useState } from "react";
import { Flag, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/tengasell/auth";
import { useI18n } from "@/lib/tengasell/i18n";
import { trustFetch } from "../trust-client";

const REASONS = [
  "prohibited",
  "counterfeit",
  "scam",
  "offplatform",
  "abusive",
  "ip_violation",
  "other",
] as const;

export function ReportItemButton({
  auctionId,
  sellerUsername,
}: {
  auctionId: number;
  sellerUsername: string;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("prohibited");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await trustFetch(user.token, "/me/reports", {
        method: "POST",
        body: JSON.stringify({
          target_type: "listing",
          target_id: String(auctionId),
          reason_code: reason,
          note,
        }),
      });
      toast({ title: t("reports.toast") });
      setDone(true);
      setOpen(false);
    } catch (err) {
      toast({
        title: t("reports.failed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <Button
        type="button"
        variant="outline"
        className="min-h-11 rounded-control w-full"
        aria-label={t("reports.signinHint")}
        title={t("reports.signinHint")}
        disabled
      >
        <Flag className="size-4" aria-hidden="true" />
        <span className="truncate">{t("reports.trigger")}</span>
      </Button>
    );
  }

  if (done) {
    return (
      <Button
        type="button"
        variant="outline"
        className="min-h-11 rounded-control w-full border-ok/40 text-ok"
        aria-label={t("reports.done")}
        disabled
      >
        <Flag className="size-4" aria-hidden="true" />
        <span className="truncate">{t("reports.done")}</span>
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 rounded-control w-full"
          aria-label={t("reports.trigger")}
        >
          <Flag className="size-4" aria-hidden="true" />
          <span className="truncate">{t("reports.trigger")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-4">
        <p className="text-label font-bold text-foreground">{t("reports.title")}</p>
        <p className="text-caption text-muted-foreground mt-0.5 mb-3">
          {t("reports.sub")} @{sellerUsername}
        </p>
        <Label className="text-caption font-semibold text-foreground">{t("reports.reason")}</Label>
        <RadioGroup
          value={reason}
          onValueChange={setReason}
          className="mt-2 gap-2"
          aria-label={t("reports.reason")}
        >
          {REASONS.map((r) => (
            <label
              key={r}
              className="flex min-h-11 items-center gap-2.5 rounded-control border border-border bg-section px-3 text-label text-foreground cursor-pointer has-[button[data-state=checked]]:border-teal has-[button[data-state=checked]]:bg-teal-tint/60"
            >
              <RadioGroupItem value={r} id={`report-reason-${r}`} />
              {t(`reports.reason.${r}`)}
            </label>
          ))}
        </RadioGroup>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("reports.notePlaceholder")}
          className="mt-3 min-h-16"
          aria-label={t("reports.notePlaceholder")}
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>
            {t("action.cancel")}
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {t("reports.submit")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
