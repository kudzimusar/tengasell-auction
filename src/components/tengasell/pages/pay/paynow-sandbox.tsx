"use client";

// Paynow sandbox checkout (#/pay/{reference}) — the mock "hosted gateway"
// page for mock-mode Paynow sessions (real mode redirects to paynow.co.zw).
//
// The page is deliberately styled like an external checkout: a neutral
// gateway card (Paynow wordmark + "Sandbox mode" chip), merchant, amount,
// reference and the paid item. Display hints arrive as query params on the
// redirect URL, but the authoritative state always comes from
// POST /api/paynow/poll (every 2.5s while pending — approvals in another
// tab are picked up too). Approve/Decline call POST /api/paynow/sandbox,
// which settles the order exactly like the trade engine's order:pay; on
// success we broadcast bus "order:update" and navigate to #/orders/{id}.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  CreditCard,
  Landmark,
  Loader2,
  Lock,
  Phone,
  ShieldCheck,
  Smartphone,
  XCircle,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { bus } from "@/lib/tengasell/bus";
import { formatUSD } from "@/lib/tengasell/format";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps, useRouter } from "@/lib/tengasell/router";
import type { Order } from "@/lib/tengasell/types";
import { EmptyState, ErrorState, TengaLogo } from "@/components/tengasell/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";

interface PollResponse {
  ok: boolean;
  status?: string;
  reference?: string;
  amount?: number;
  method?: string;
  phone?: string | null;
  orderId?: number;
  title?: string;
  payBy?: string | null;
  order?: Order | null;
  error?: string;
}

type Phase = "loading" | "pending" | "paid" | "cancelled" | "notfound" | "error";

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const last4 = digits.slice(-4) || "••••";
  return `••• ••• ${last4}`;
}

function methodLabel(method: string | undefined): string {
  switch (method) {
    case "ecocash":
      return "EcoCash";
    case "innbucks":
      return "InnBucks";
    case "card":
      return "Visa / Mastercard";
    default:
      return method ?? "Paynow";
  }
}

export default function PaynowSandboxPage({ reference }: { reference: string }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const { route, navigate } = useRouter();

  // display hints from the redirect URL (re-verified by the poll below)
  const hintAmount = Number(route.query.get("amount") ?? "0");
  const hintMethod = route.query.get("method") ?? undefined;
  const hintPhone = route.query.get("phone") ?? null;
  const hintTitle = route.query.get("title") ?? "";
  const hintOrderId = Number(route.query.get("order") ?? "0");

  const [phase, setPhase] = useState<Phase>(reference ? "loading" : "notfound");
  const [data, setData] = useState<PollResponse | null>(null);
  const [acting, setActing] = useState<"approve" | "decline" | null>(null);
  const redirected = useRef(false);
  const notFound = useRef(false);

  const pollOnce = useCallback(async () => {
    if (!reference || redirected.current || notFound.current) return;
    try {
      const res = await fetch("/api/paynow/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference }),
      });
      const body = (await res.json().catch(() => null)) as PollResponse | null;
      if (!res.ok || !body?.ok) {
        if (res.status === 404) {
          notFound.current = true;
          setPhase("notfound");
        } else {
          setPhase("error");
        }
        return;
      }
      setData(body);
      const status = body.status ?? "pending";
      setPhase(
        status === "paid"
          ? "paid"
          : status === "cancelled" || status === "failed"
            ? "cancelled"
            : "pending",
      );
    } catch {
      setPhase("error");
    }
  }, [reference]);

  // initial check + poll loop while the session is still open
  useEffect(() => {
    if (!reference) return;
    void pollOnce();
    const timer = setInterval(() => {
      void pollOnce();
    }, 2500);
    return () => clearInterval(timer);
  }, [reference, pollOnce]);

  // paid (anywhere — this tab or another) → broadcast + navigate
  useEffect(() => {
    if (phase !== "paid" && phase !== "cancelled") return;
    if (redirected.current) return;
    const orderId = data?.orderId ?? hintOrderId;
    if (!orderId) return;
    redirected.current = true;
    if (phase === "paid" && data?.order) {
      bus.emit("order:update", { order: data.order });
      toast({
        title: "Payment approved 🎉",
        description: `Order #${orderId} paid · ${formatUSD(data.order.final_price)} — the seller dispatches within 3 days.`,
      });
    } else if (phase === "cancelled") {
      toast({
        title: t("sandbox.cancelled"),
        description: t("sandbox.cancelledBody"),
      });
    }
    // no cleanup on purpose — the timeout navigates away (guarded by the
    // redirected ref so deps changes can never schedule a second one)
    setTimeout(() => navigate(`/orders/${orderId}`), phase === "paid" ? 1200 : 1400);
  }, [phase, data, hintOrderId, navigate, t]);

  const act = async (action: "approve" | "decline") => {
    if (acting || phase !== "pending" || !reference) return;
    setActing(action);
    try {
      const res = await fetch("/api/paynow/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, action }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; status?: string; order?: Order | null; error?: string }
        | null;
      if (!res.ok || !body?.ok) {
        toast({
          title: "Sandbox action failed",
          description: body?.error ?? "Please retry the simulated approval.",
          variant: "destructive",
        });
        return;
      }
      if (body.status === "paid") {
        const settledOrder = body.order ?? null;
        setData((d): PollResponse => ({
          ...(d ?? {}),
          ok: true,
          status: "paid",
          order: settledOrder,
        }));
        setPhase("paid");
      } else {
        setPhase("cancelled");
      }
    } catch {
      toast({
        title: "Sandbox action failed",
        description: "Could not reach the payment simulation — please retry.",
        variant: "destructive",
      });
    } finally {
      setActing(null);
    }
  };

  const amount = data?.amount ?? (hintAmount > 0 ? hintAmount : null);
  const method = data?.method ?? hintMethod;
  const phone = data?.phone ?? hintPhone;
  const title = data?.title || hintTitle;
  const orderId = data?.orderId ?? hintOrderId;
  const orderLink = useLinkProps(orderId ? `/orders/${orderId}` : "/orders");
  const mobile = method === "ecocash" || method === "innbucks";

  return (
    <div className="mx-auto max-w-md px-4 py-8 sm:py-12">
      <a
        {...orderLink}
        className="inline-flex min-h-11 items-center gap-1 rounded-control text-label font-semibold text-teal hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("sandbox.backToOrder")}
      </a>

      <section
        aria-label="Paynow checkout"
        className="mt-3 overflow-hidden rounded-card border border-border bg-raised shadow-sm"
      >
        {/* gateway header */}
        <header className="border-b border-border bg-section px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-title font-extrabold tracking-tight text-foreground">
              Pay<span className="text-gold-deep">now</span>
            </p>
            <span className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold-soft px-2.5 py-1 text-caption font-semibold text-gold-deep">
              <Lock className="size-3.5" aria-hidden="true" />
              {t("sandbox.chip")}
            </span>
          </div>
          <p className="mt-1 text-caption text-muted-foreground">
            {t("sandbox.secure")} · paynow.co.zw
          </p>
        </header>

        <div className="px-5 py-5 space-y-5">
          {/* merchant + amount */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <TengaLogo size={26} withWordmark={false} />
              <div className="min-w-0">
                <p className="text-label font-bold text-foreground">Tengasell</p>
                <p className="text-caption text-muted-foreground">{t("sandbox.merchant")}</p>
              </div>
            </div>
            {amount != null ? (
              <p className="ts-numeric text-headline font-extrabold text-foreground">
                {formatUSD(amount)}
              </p>
            ) : (
              <Skeleton className="h-8 w-24" />
            )}
          </div>

          {/* payment details */}
          <dl className="space-y-2.5 rounded-control border border-border bg-section p-3.5 text-caption">
            <div className="flex items-start justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{t("sandbox.reference")}</dt>
              <dd className="ts-numeric truncate font-semibold text-foreground">{reference || "—"}</dd>
            </div>
            {title ? (
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{t("sandbox.item")}</dt>
                <dd className="line-clamp-2 text-right font-medium text-foreground">{title}</dd>
              </div>
            ) : null}
            <div className="flex items-start justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{t("sandbox.method")}</dt>
              <dd className="text-right font-medium text-foreground">
                {phase === "loading" && !method ? (
                  <Skeleton className="ml-auto h-4 w-20" />
                ) : (
                  <>
                    {methodLabel(method)}
                    {maskPhone(phone) ? (
                      <span className="ts-numeric block text-muted-foreground">
                        {maskPhone(phone)}
                      </span>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
          </dl>

          {/* state area */}
          {phase === "loading" ? (
            <div className="flex flex-col items-center gap-3 py-6" aria-busy="true">
              <Loader2 className="size-8 animate-spin text-teal-soft" aria-hidden="true" />
              <p className="text-label font-semibold text-muted-foreground">{t("state.loading")}</p>
            </div>
          ) : phase === "notfound" ? (
            <EmptyState
              icon={<XCircle className="size-10 text-danger" />}
              title={t("sandbox.notFound")}
              body={t("sandbox.notFoundBody")}
              action={
                <Button asChild className="min-h-11 rounded-control px-6">
                  <a {...orderLink}>{t("sandbox.backToOrder")}</a>
                </Button>
              }
            />
          ) : phase === "error" ? (
            <ErrorState message="Could not reach the payment gateway." onRetry={() => void pollOnce()} />
          ) : phase === "cancelled" ? (
            <div className="flex flex-col items-center gap-3 rounded-control border border-danger/30 bg-danger/5 p-5 text-center" role="status">
              <XCircle className="size-10 text-danger" aria-hidden="true" />
              <p className="text-title font-bold text-danger">{t("sandbox.cancelled")}</p>
              <p className="max-w-xs text-caption text-muted-foreground">{t("sandbox.cancelledBody")}</p>
              <Button asChild variant="outline" className="min-h-11 rounded-control">
                <a {...orderLink}>{t("sandbox.backToOrder")}</a>
              </Button>
            </div>
          ) : phase === "paid" ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
              <span className="relative inline-flex">
                {!reduced && (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-gold/40"
                    initial={{ scale: 0.8, opacity: 0.8 }}
                    animate={{ scale: 1.8, opacity: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                )}
                <motion.span
                  initial={reduced ? undefined : { scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 320, damping: 20 }}
                  className="grid size-16 place-items-center rounded-full bg-gold text-gold-on"
                >
                  <Check className="size-9" strokeWidth={3} aria-hidden="true" />
                </motion.span>
              </span>
              <p className="text-title font-bold text-foreground">{t("sandbox.paid")}</p>
              <p className="max-w-xs text-caption text-muted-foreground">{t("sandbox.paidBody")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* "approve on your phone" simulation for mobile money */}
              <div className="flex items-center gap-3 rounded-control bg-teal-tint/70 dark:bg-teal-tint/40 p-4">
                <span className="relative grid size-12 shrink-0 place-items-center">
                  {!reduced && (
                    <motion.span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full bg-teal/25"
                      animate={{ scale: [1, 1.35, 1], opacity: [0.7, 0, 0.7] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                    />
                  )}
                  {mobile ? (
                    <Smartphone className="relative size-6 text-teal-deep dark:text-teal-soft" aria-hidden="true" />
                  ) : (
                    <CreditCard className="relative size-6 text-teal-deep dark:text-teal-soft" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-label font-bold text-teal-deep dark:text-teal-soft">
                    {mobile ? <Phone className="size-4" aria-hidden="true" /> : <CreditCard className="size-4" aria-hidden="true" />}
                    {mobile ? t("sandbox.checkPhone") : t("sandbox.awaiting")}
                  </p>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    {mobile ? t("sandbox.awaiting") : t("paynow.cardNote")}
                  </p>
                </div>
              </div>

              <div className="grid gap-2.5">
                <Button
                  onClick={() => void act("approve")}
                  disabled={acting != null}
                  className="min-h-12 rounded-control bg-teal text-white text-bodyStrong hover:bg-teal/90"
                >
                  {acting === "approve" ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Approving…
                    </>
                  ) : (
                    <>
                      <BadgeCheck className="size-4" aria-hidden="true" />
                      {mobile ? t("sandbox.approve") : t("sandbox.approveCard")}
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => void act("decline")}
                  disabled={acting != null}
                  variant="outline"
                  className="min-h-11 rounded-control"
                >
                  {acting === "decline" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <XCircle className="size-4" aria-hidden="true" />
                  )}
                  {t("sandbox.decline")}
                </Button>
              </div>
            </div>
          )}
        </div>

        <footer className="border-t border-border bg-section px-5 py-3.5">
          <p className="flex items-start gap-2 text-caption leading-relaxed text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-teal-soft" aria-hidden="true" />
            {t("sandbox.secureNote")}
          </p>
        </footer>
      </section>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-caption text-muted-foreground">
        <Landmark className="size-3.5" aria-hidden="true" />
        EcoCash · InnBucks · Visa · Mastercard · ZimSwitch · PayPal
      </p>
    </div>
  );
}
