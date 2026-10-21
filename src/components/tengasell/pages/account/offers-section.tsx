"use client";

// Gap-8 F2: My Offers section (#/my/offers) — Best-Offer flow, both sides.
// "Sent" = offers I made as a buyer (withdraw pending, answer counters).
// "Received" = offers on my listings as a seller (accept [instant sale] /
// counter / decline). Realtime refresh via the engine's "offer:update".

import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  Handshake,
  Loader2,
  Tag,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { LinkButton } from "./auth-shared";
import {
  EmptyState,
  ErrorState,
  LoadingGrid,
  PriceTag,
  SectionHeader,
} from "@/components/tengasell/ui";
import { api } from "@/lib/tengasell/api";
import { bus } from "@/lib/tengasell/bus";
import { useI18n } from "@/lib/tengasell/i18n";
import {
  formatDateTime,
  formatRelative,
  formatUSD,
  round2,
} from "@/lib/tengasell/format";
import { useResource } from "@/lib/tengasell/hooks";
import { useLinkProps } from "@/lib/tengasell/router";
import type { Auction, Offer } from "@/lib/tengasell/types";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── local helpers ────────────────────────────────────────────────────

/** Engine offer-broadcast payload. The shared bus EventMap predates
 *  "offer:update" (bus.ts is orchestrator-owned) — subscribe through a
 *  typed widening shim. */
type OfferUpdatePayload = { auctionId: number; offer: Offer };

function onOfferUpdate(handler: (p: OfferUpdatePayload) => void): () => void {
  return (
    bus as unknown as {
      on: (e: string, h: (p: OfferUpdatePayload) => void) => () => void;
    }
  ).on("offer:update", handler);
}

/** Yahoo-style buyer masking for offer rows: "simba" → "si***a". */
function maskUser(name: string): string {
  if (!name) return "—";
  if (name.length <= 3) return `${name[0]!}***`;
  return `${name.slice(0, 2)}***${name.slice(-1)}`;
}

/** Offer status pill — pending=teal, countered=gold, accepted=teal-deep,
 *  declined=urgent, expired/withdrawn=muted. */
function OfferPill({ status, label }: { status: Offer["status"]; label: string }) {
  const tones: Record<Offer["status"], string> = {
    pending: "bg-teal-tint text-teal-deep dark:text-teal-soft border-teal/25",
    countered: "bg-gold-soft text-gold-deep border-gold/30",
    accepted: "bg-teal-deep text-white border-teal-deep",
    declined: "bg-danger/10 text-urgent border-danger/25",
    expired: "bg-muted text-muted-foreground border-border",
    withdrawn: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border px-2 py-0.5 text-caption font-bold whitespace-nowrap",
        tones[status],
      )}
    >
      {label}
    </span>
  );
}

type OfferAction = "accept" | "decline" | "withdraw" | "acceptCounter" | "declineCounter";

/** Shared action runner: engine errors are user-meaningful — surface inline. */
function useOfferAction(onChanged: () => void) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<OfferAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (
    kind: OfferAction,
    fn: () => Promise<unknown>,
    okTitle: string,
  ) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await fn();
      toast({ title: okTitle });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("itemoffer.errGeneric"));
    } finally {
      setBusy(null);
    }
  };
  return { busy, setBusy, error, setError, run };
}

// ── section ──────────────────────────────────────────────────────────

export function OffersSection() {
  const { t } = useI18n();
  const [tab, setTab] = useState("sent");

  return (
    <section aria-labelledby="offers-heading" className="min-w-0">
      <SectionHeader
        title={<span id="offers-heading">{t("offers.title")}</span>}
        subtitle={t("offers.subtitle")}
      />
      <div className="px-4 pt-4 min-w-0">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="w-full h-auto flex-wrap p-1 gap-0.5 rounded-control">
            <TabsTrigger
              value="sent"
              className="min-h-11 flex-1 px-2 text-label rounded-control"
            >
              <Handshake className="size-4" aria-hidden="true" />
              {t("offers.sent")}
            </TabsTrigger>
            <TabsTrigger
              value="received"
              className="min-h-11 flex-1 px-2 text-label rounded-control"
            >
              <Tag className="size-4" aria-hidden="true" />
              {t("offers.received")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sent" className="pt-4">
            <SentOffersList />
          </TabsContent>
          <TabsContent value="received" className="pt-4">
            <ReceivedOffersList />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}

// ── sent (buyer) ─────────────────────────────────────────────────────

function SentOffersList() {
  const { t } = useI18n();
  const res = useResource(
    async () => {
      const offers = await api.myOffers();
      const ids = [...new Set(offers.map((o) => o.auction_id))];
      const auctions = await Promise.all(
        ids.map((aid) => api.auction(aid).catch(() => null)),
      );
      const titles = new Map<number, string>();
      for (const a of auctions) if (a) titles.set(a.id, a.title);
      const sorted = [...offers].sort(
        (x, y) => Date.parse(y.created_at) - Date.parse(x.created_at),
      );
      return { offers: sorted, titles };
    },
    [],
  );
  const { reload } = res;

  // realtime: any offer event refreshes the list (cheap, few rows)
  useEffect(() => onOfferUpdate(() => reload()), [reload]);

  if (res.loading && !res.data) {
    return (
      <div aria-busy="true" aria-label={t("state.loading")}>
        <LoadingGrid count={4} />
      </div>
    );
  }
  if (res.error) return <ErrorState message={res.error} onRetry={reload} />;

  const offers = res.data?.offers ?? [];
  if (offers.length === 0) {
    return (
      <EmptyState
        icon={<Handshake className="size-10" />}
        title={t("offers.sentEmpty")}
        body={t("offers.emptyHint")}
        action={<LinkButton to="/search">{t("offers.browse")}</LinkButton>}
      />
    );
  }

  return (
    <ul
      className={cn(
        "space-y-3",
        offers.length > 8 && "max-h-96 overflow-y-auto ts-scrollbar",
      )}
      aria-label={t("offers.sent")}
    >
      {offers.map((o) => (
        <SentOfferCard
          key={o.id}
          offer={o}
          title={res.data?.titles.get(o.auction_id) ?? `#${o.auction_id}`}
          onChanged={reload}
        />
      ))}
    </ul>
  );
}

function SentOfferCard({
  offer,
  title,
  onChanged,
}: {
  offer: Offer;
  title: string;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const itemLink = useLinkProps(`/item/${offer.auction_id}`);
  const { busy, error, run } = useOfferAction(onChanged);
  const [acceptCounterOpen, setAcceptCounterOpen] = useState(false);

  const counterSentence =
    locale === "ja"
      ? `${t("itemoffer.acceptCounterPre")}${formatUSD(offer.counter_amount ?? offer.amount)}${t("itemoffer.acceptCounterPost")}`
      : `${t("itemoffer.acceptCounterPre")} ${formatUSD(offer.counter_amount ?? offer.amount)} ${t("itemoffer.acceptCounterPost")}`;

  return (
    <li className="rounded-card border border-border bg-raised p-4 space-y-2 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <a
          {...itemLink}
          className="text-bodyStrong text-foreground hover:text-teal transition-colors line-clamp-2 min-w-0 flex-1"
        >
          {title}
        </a>
        <OfferPill status={offer.status} label={t(`offers.status.${offer.status}`)} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
        <span className="ts-numeric">
          {t("offers.youOffered")}{" "}
          <PriceTag amount={offer.amount} size="sm" className="align-baseline" />
        </span>
        <time title={formatDateTime(offer.created_at)}>{formatRelative(offer.created_at)}</time>
      </div>

      {offer.message && (
        <p className="text-caption text-muted-foreground italic border-s-2 border-border ps-2">
          “{offer.message}”
        </p>
      )}

      {offer.status === "countered" && (
        <div className="rounded-control bg-gold-soft/70 dark:bg-gold-soft/25 p-2.5 space-y-1">
          <p className="text-caption font-semibold text-gold-deep">
            {t("itemoffer.counteredBy")}{" "}
            <span className="ts-numeric">{formatUSD(offer.counter_amount ?? offer.amount)}</span>
          </p>
          {offer.counter_message && (
            <p className="text-caption text-foreground italic">“{offer.counter_message}”</p>
          )}
        </div>
      )}

      {(offer.status === "pending" || offer.status === "countered") && (
        <div className="flex flex-wrap items-center gap-2">
          {offer.status === "countered" ? (
            <>
              <Button
                onClick={() => setAcceptCounterOpen(true)}
                disabled={busy != null}
                className="min-h-11 rounded-control"
              >
                {busy === "acceptCounter" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="size-4" aria-hidden="true" />
                )}
                {t("itemoffer.acceptCounter")}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void run(
                    "declineCounter",
                    () => api.acceptCounter(offer.id, false),
                    t("itemoffer.counterDeclined"),
                  )
                }
                disabled={busy != null}
                className="min-h-11 rounded-control"
              >
                {busy === "declineCounter" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <X className="size-4" aria-hidden="true" />
                )}
                {t("itemoffer.declineCounter")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() =>
                void run("withdraw", () => api.withdrawOffer(offer.id), t("itemoffer.withdrawn"))
              }
              disabled={busy != null}
              className="min-h-11 rounded-control"
            >
              {busy === "withdraw" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <X className="size-4" aria-hidden="true" />
              )}
              {t("itemoffer.withdraw")}
            </Button>
          )}
          <LinkButton to={`/item/${offer.auction_id}`} variant="ghost" className="px-3">
            {t("offers.viewItem")}
          </LinkButton>
        </div>
      )}

      {offer.status === "accepted" && (
        <div>
          <LinkButton to={`/item/${offer.auction_id}`} variant="outline" className="px-4">
            {t("offers.viewItem")}
          </LinkButton>
        </div>
      )}

      {error && (
        <p role="alert" className="text-caption font-medium text-urgent">
          {error}
        </p>
      )}

      {/* accepting the counter = instant sale at the counter price — confirm */}
      <AlertDialog open={acceptCounterOpen} onOpenChange={setAcceptCounterOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("itemoffer.acceptCounterTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{counterSentence}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void run(
                  "acceptCounter",
                  () => api.acceptCounter(offer.id, true),
                  t("itemoffer.youWon"),
                )
              }
            >
              {t("itemoffer.acceptCounter")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

// ── received (seller) ────────────────────────────────────────────────

type ReceivedRow = { auction: Auction; offer: Offer };

function ReceivedOffersList() {
  const { t } = useI18n();
  const res = useResource(
    async () => {
      const selling = await api.mySelling();
      const offerable = selling.filter((a) => a.allow_offers === 1);
      const lists = await Promise.all(
        offerable.map((a) => api.offersFor(a.id).catch(() => [] as Offer[])),
      );
      const rows: ReceivedRow[] = [];
      offerable.forEach((a, i) => {
        for (const o of lists[i]) rows.push({ auction: a, offer: o });
      });
      rows.sort((x, y) => y.offer.id - x.offer.id);
      return rows;
    },
    [],
  );
  const { reload } = res;

  useEffect(() => onOfferUpdate(() => reload()), [reload]);

  if (res.loading && !res.data) {
    return (
      <div aria-busy="true" aria-label={t("state.loading")}>
        <LoadingGrid count={4} />
      </div>
    );
  }
  if (res.error) return <ErrorState message={res.error} onRetry={reload} />;

  const rows = res.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Tag className="size-10" />}
        title={t("offers.receivedEmpty")}
        body={t("offers.emptyHint")}
        action={
          <LinkButton to="/sell/new" variant="gold">
            {t("offers.sellCta")}
          </LinkButton>
        }
      />
    );
  }

  return (
    <ul
      className={cn(
        "space-y-3",
        rows.length > 8 && "max-h-96 overflow-y-auto ts-scrollbar",
      )}
      aria-label={t("offers.received")}
    >
      {rows.map((row) => (
        <ReceivedOfferRow
          key={`${row.offer.auction_id}-${row.offer.id}`}
          auction={row.auction}
          offer={row.offer}
          onChanged={reload}
        />
      ))}
    </ul>
  );
}

function ReceivedOfferRow({
  auction,
  offer,
  onChanged,
}: {
  auction: Auction;
  offer: Offer;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const itemLink = useLinkProps(`/item/${auction.id}`);
  const { busy, error, run } = useOfferAction(onChanged);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);

  const live = auction.status === "live";
  const pending = offer.status === "pending" && live;
  const countered = offer.status === "countered";

  const acceptSentence =
    locale === "ja"
      ? `${t("itemoffer.acceptPre")}${maskUser(offer.buyer_username)}${t("itemoffer.acceptMid")}${formatUSD(offer.amount)}${t("itemoffer.acceptPost")}`
      : `${t("itemoffer.acceptPre")} ${maskUser(offer.buyer_username)} ${t("itemoffer.acceptMid")} ${formatUSD(offer.amount)} ${t("itemoffer.acceptPost")}`;

  return (
    <li className="rounded-card border border-border bg-raised p-4 space-y-2 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <a
          {...itemLink}
          className="text-bodyStrong text-foreground hover:text-teal transition-colors line-clamp-2 min-w-0 flex-1"
        >
          {auction.title}
        </a>
        <OfferPill status={offer.status} label={t(`offers.status.${offer.status}`)} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
        <span>
          {t("itemoffer.buyer")}{" "}
          <strong className="text-foreground">{maskUser(offer.buyer_username)}</strong>
        </span>
        <PriceTag amount={offer.amount} size="sm" className="align-baseline" />
        <time title={formatDateTime(offer.created_at)}>{formatRelative(offer.created_at)}</time>
      </div>

      {offer.message && (
        <p className="text-caption text-muted-foreground italic border-s-2 border-border ps-2">
          “{offer.message}”
        </p>
      )}

      {countered && (
        <p className="text-caption text-muted-foreground">
          <span className="font-semibold text-gold-deep">
            {t("itemoffer.counter")} · {t("itemoffer.waitingBuyer")}
          </span>{" "}
          <span className="ts-numeric">{formatUSD(offer.counter_amount ?? offer.amount)}</span>
        </p>
      )}

      {pending && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => setAcceptOpen(true)}
            disabled={busy != null}
            className="min-h-11 rounded-control"
          >
            {busy === "accept" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
            {t("itemoffer.accept")}
          </Button>
          <Button
            variant="outline"
            onClick={() => setCounterOpen(true)}
            disabled={busy != null}
            className="min-h-11 rounded-control"
          >
            {busy === "decline" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowLeftRight className="size-4" aria-hidden="true" />
            )}
            {t("itemoffer.counter")}
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              void run("decline", () => api.respondOffer(offer.id, "decline"), t("itemoffer.declined"))
            }
            disabled={busy != null}
            className="min-h-11 rounded-control text-muted-foreground"
          >
            {busy === "decline" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <X className="size-4" aria-hidden="true" />
            )}
            {t("itemoffer.decline")}
          </Button>
          <LinkButton to={`/item/${auction.id}`} variant="ghost" className="px-3">
            {t("offers.viewItem")}
          </LinkButton>
        </div>
      )}

      {error && (
        <p role="alert" className="text-caption font-medium text-urgent">
          {error}
        </p>
      )}

      {/* accepting = instant sale — confirm */}
      <AlertDialog open={acceptOpen} onOpenChange={setAcceptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("itemoffer.acceptTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{acceptSentence}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void run("accept", () => api.respondOffer(offer.id, "accept"), t("itemoffer.accepted"))
              }
            >
              {t("itemoffer.accept")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CounterDialog
        offer={offer}
        open={counterOpen}
        onOpenChange={setCounterOpen}
        onDone={() => {
          setCounterOpen(false);
          toast({ title: t("itemoffer.counterSent") });
          onChanged();
        }}
      />
    </li>
  );
}

/** Seller counter-offer composer — amount + optional message. */
function CounterDialog({
  offer,
  open,
  onOpenChange,
  onDone,
}: {
  offer: Offer;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(offer.amount % 1 === 0 ? String(offer.amount) : offer.amount.toFixed(2));
      setMessage("");
      setError(null);
    }
  }, [open, offer.amount]);

  const parsed = Number(value.replace(/[^0-9.]/g, ""));

  const submit = async () => {
    if (busy) return;
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError(t("itemoffer.minAmount"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.respondOffer(offer.id, "counter", round2(parsed), message.trim() || undefined);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("itemoffer.errGeneric"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("itemoffer.counterTitle")}</DialogTitle>
          <DialogDescription>{t("itemoffer.counterDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-control bg-muted/60 p-3 text-caption flex items-center justify-between">
            <span className="text-muted-foreground">
              {t("itemoffer.buyer")} · {maskUser(offer.buyer_username)}
            </span>
            <PriceTag amount={offer.amount} size="sm" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="my-offers-counter-amount" className="text-label text-foreground">
              {t("itemoffer.counterAmount")}
            </label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 start-3 flex items-center text-bodyStrong font-bold text-muted-foreground pointer-events-none"
              >
                $
              </span>
              <Input
                id="my-offers-counter-amount"
                inputMode="decimal"
                autoComplete="off"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(null);
                }}
                disabled={busy}
                aria-invalid={!!error}
                className="pl-7 h-12 text-title font-bold ts-numeric"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="my-offers-counter-msg" className="text-label text-foreground">
              {t("itemoffer.counterMessage")}
            </label>
            <Textarea
              id="my-offers-counter-msg"
              rows={3}
              maxLength={300}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={busy}
            />
            <p className="text-caption text-muted-foreground">{t("itemoffer.messageHint")}</p>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-control border border-danger/40 bg-danger/10 text-urgent text-caption font-medium p-3"
            >
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              className="min-h-11 rounded-control"
            >
              {t("action.cancel")}
            </Button>
            <Button onClick={submit} disabled={busy} className="min-h-11 rounded-control">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("itemoffer.counterSend")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
