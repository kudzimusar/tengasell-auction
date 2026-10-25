"use client";

import { useState } from "react";
import { CheckCircle2, ClipboardList, ShieldCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/tengasell/ui";
import { useResource } from "@/lib/tengasell/hooks";
import { rpc } from "@/lib/tengasell/socket";
import { formatDateTime } from "@/lib/tengasell/format";
import type { Order } from "@/lib/tengasell/types";
import { cn } from "@/lib/utils";

type SettlementBundle = {
  ok: boolean;
  settlement: {
    id: number;
    order_id: number;
    auction_id: number;
    payment_state: string;
    paid_amount: number;
    outstanding_amount: number;
    invoice_total: number;
    currency: string;
    settlement_deadline?: string | null;
    transfer_state: string;
    dispute_state: string;
    release_state: string;
    transport_state: string;
    completion_state: string;
    seller_payout_state?: string | null;
  };
  invoiceLines: Array<{ id: number; line_key: string; label: string; amount: number; currency: string }>;
  transferDocuments: Array<{ id: number; document_type: string; status: string; external_process: number }>;
  releaseAuthorization?: { id: number; authorization_ref: string; status: string; collector_type: string } | null;
  transport: Array<{ id: number; transporter: string; pickup_location: string; destination: string; scheduled_at?: string | null; status: string }>;
  handover?: { id: number; handed_over_at: string; evidence_reference: string } | null;
};

export function VehicleSettlementActionNotice({
  order,
  role,
}: {
  order: Order;
  role: "buyer" | "seller";
}) {
  return (
    <aside className="rounded-card border border-teal/30 bg-teal-tint/40 p-4 sm:p-5" aria-label="Vehicle settlement authority">
      <ShieldCheck className="size-6 text-teal" aria-hidden="true" />
      <h2 className="mt-2 text-bodyStrong font-bold text-foreground">
        {role === "buyer" ? "Vehicle settlement" : "Vehicle sale settlement"}
      </h2>
      <p className="mt-2 text-caption leading-relaxed text-muted-foreground">
        {role === "buyer"
          ? "Payment, statutory transfer readiness, physical release and handover are controlled by the auction settlement below. A client action cannot mark this vehicle paid or released."
          : "Do not dispatch this vehicle through the generic marketplace flow. Release follows Finance confirmation, transfer evidence and explicit yard authorization."}
      </p>
      {order.pay_by ? (
        <p className="mt-3 text-caption font-semibold text-foreground">
          Current settlement deadline: {formatDateTime(order.pay_by)}
        </p>
      ) : null}
    </aside>
  );
}

export function VehicleAuctionSettlementCard({
  order,
  role,
}: {
  order: Order;
  role: "buyer" | "seller";
}) {
  const settlementRes = useResource<SettlementBundle>(
    () => rpc<SettlementBundle>("settlement:bundle", { orderId: order.id }),
    [order.id],
  );
  const [transporter, setTransporter] = useState("");
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [transportBusy, setTransportBusy] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);

  if (settlementRes.loading && !settlementRes.data) {
    return <Skeleton className="h-80 rounded-card" />;
  }
  if (settlementRes.error || !settlementRes.data?.settlement) {
    return (
      <section aria-label="Vehicle auction settlement">
        <ErrorState
          message={settlementRes.error ?? "Vehicle auction settlement is not available."}
          onRetry={settlementRes.reload}
        />
      </section>
    );
  }

  const bundle = settlementRes.data;
  const s = bundle.settlement;
  const paymentDone = s.payment_state === "PAID";
  const transferDone = s.transfer_state === "COMPLETE";
  const releaseDone = ["AUTHORIZED", "RELEASED"].includes(s.release_state);
  const transportDone = ["DELIVERED", "CANCELLED"].includes(s.transport_state) || !!bundle.handover;
  const complete = s.completion_state === "COMPLETE";
  const lifecycle = [
    { label: "Won", done: true, detail: "Order #" + order.id },
    { label: "Invoice", done: bundle.invoiceLines.length > 0, detail: s.currency + " " + Number(s.invoice_total).toFixed(2) },
    { label: "Payment", done: paymentDone, detail: s.payment_state },
    { label: "Transfer", done: transferDone, detail: s.transfer_state },
    { label: "Release", done: releaseDone, detail: s.release_state },
    { label: "Collection / Transport", done: transportDone, detail: s.transport_state },
    { label: "Complete", done: complete, detail: s.completion_state },
  ];

  const requestTransport = async () => {
    if (role !== "buyer" || transportBusy) return;
    if (transporter.trim().length < 2 || pickup.trim().length < 2 || destination.trim().length < 2) {
      setTransportError("Enter the transporter, pickup location and destination.");
      return;
    }
    setTransportBusy(true);
    setTransportError(null);
    try {
      await rpc("settlement:transport-request", {
        requestId: globalThis.crypto.randomUUID(),
        settlementId: s.id,
        transporter: transporter.trim(),
        pickupLocation: pickup.trim(),
        destination: destination.trim(),
      });
      setTransporter("");
      setPickup("");
      setDestination("");
      await settlementRes.reload();
    } catch (cause) {
      setTransportError(cause instanceof Error ? cause.message : "Transport request failed.");
    } finally {
      setTransportBusy(false);
    }
  };

  return (
    <section aria-labelledby="vehicle-settlement-heading" className="rounded-card border border-border bg-raised p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="vehicle-settlement-heading" className="text-lg font-bold text-foreground">Won-lot vehicle settlement</h2>
          <p className="mt-1 text-caption text-muted-foreground">
            Commercial sale and statutory ownership transfer are separate. External transfer remains pending until accepted evidence is recorded.
          </p>
        </div>
        <span className={cn(
          "rounded-pill px-2.5 py-1 text-caption font-bold",
          complete ? "bg-ok/10 text-ok" : s.dispute_state === "OPEN" ? "bg-danger/10 text-danger" : "bg-gold/10 text-gold-deep",
        )}>
          {complete ? "COMPLETE" : s.dispute_state === "OPEN" ? "DISPUTED" : "ACTION REQUIRED"}
        </span>
      </div>

      <ol className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Vehicle settlement lifecycle">
        {lifecycle.map((step) => (
          <li key={step.label} className="rounded-control border border-border bg-background p-3">
            <div className="flex items-center gap-2">
              {step.done ? (
                <CheckCircle2 className="size-4 text-ok" aria-hidden="true" />
              ) : (
                <ClipboardList className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="font-bold text-foreground">{step.label}</span>
            </div>
            <p className="mt-1 text-caption text-muted-foreground">{step.detail}</p>
          </li>
        ))}
      </ol>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-control border border-border bg-background p-4">
          <h3 className="font-bold text-foreground">Invoice &amp; Finance</h3>
          <div className="mt-3 space-y-2">
            {bundle.invoiceLines.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-4 text-caption">
                <span className="text-muted-foreground">{line.label}</span>
                <span className="font-bold tabular-nums text-foreground">
                  {line.currency} {Number(line.amount).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-border pt-3 text-caption">
            <p>Paid: <strong>{s.currency} {Number(s.paid_amount).toFixed(2)}</strong></p>
            <p>Outstanding: <strong>{s.currency} {Number(s.outstanding_amount).toFixed(2)}</strong></p>
            {s.settlement_deadline ? <p>Deadline: <strong>{formatDateTime(s.settlement_deadline)}</strong></p> : null}
          </div>
          {!paymentDone ? (
            <p className="mt-3 rounded-control border border-gold/30 bg-gold/10 p-3 text-caption text-foreground">
              Payment is pending Finance confirmation. This screen never treats a client confirmation as proof of payment.
            </p>
          ) : null}
        </div>

        <div className="rounded-control border border-border bg-background p-4">
          <h3 className="font-bold text-foreground">Transfer &amp; release</h3>
          <p className="mt-2 text-caption text-muted-foreground">
            Transfer: <strong className="text-foreground">{s.transfer_state}</strong> · Release: <strong className="text-foreground">{s.release_state}</strong>
          </p>
          <div className="mt-3 space-y-2">
            {bundle.transferDocuments.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between gap-3 rounded-control border border-border p-2 text-caption">
                <span>{doc.document_type.replaceAll("_", " ")}</span>
                <span className="font-bold">{doc.external_process ? "EXTERNAL · " : ""}{doc.status}</span>
              </div>
            ))}
            {!bundle.transferDocuments.length ? (
              <p className="text-caption text-muted-foreground">Transfer requirements have not yet been issued.</p>
            ) : null}
          </div>
          {bundle.releaseAuthorization ? (
            <p className="mt-3 text-caption font-semibold text-foreground">
              Release authorization: {bundle.releaseAuthorization.authorization_ref} · {bundle.releaseAuthorization.status}
            </p>
          ) : (
            <p className="mt-3 text-caption text-muted-foreground">No physical release authorization has been issued.</p>
          )}
        </div>
      </div>

      {role === "buyer" && !complete ? (
        <div className="mt-5 rounded-control border border-border bg-background p-4">
          <div className="flex items-center gap-2">
            <Truck className="size-5 text-teal" aria-hidden="true" />
            <h3 className="font-bold text-foreground">Collection / transport request</h3>
          </div>
          <p className="mt-1 text-caption text-muted-foreground">
            Requesting transport does not authorize vehicle release. Yard handover remains blocked until the release gate is satisfied.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="text-caption font-semibold text-foreground">
              Transporter
              <input value={transporter} onChange={(e) => setTransporter(e.target.value)} className="mt-1 min-h-11 w-full rounded-control border border-input bg-background px-3 text-sm" />
            </label>
            <label className="text-caption font-semibold text-foreground">
              Pickup location
              <input value={pickup} onChange={(e) => setPickup(e.target.value)} className="mt-1 min-h-11 w-full rounded-control border border-input bg-background px-3 text-sm" />
            </label>
            <label className="text-caption font-semibold text-foreground">
              Destination
              <input value={destination} onChange={(e) => setDestination(e.target.value)} className="mt-1 min-h-11 w-full rounded-control border border-input bg-background px-3 text-sm" />
            </label>
          </div>
          {transportError ? <p role="alert" className="mt-3 text-caption font-semibold text-danger">{transportError}</p> : null}
          <Button className="mt-3 min-h-11" variant="outline" disabled={transportBusy} onClick={() => void requestTransport()}>
            <Truck className="size-4" aria-hidden="true" />
            {transportBusy ? "Requesting…" : "Request transport"}
          </Button>
        </div>
      ) : null}

      {bundle.transport.length ? (
        <div className="mt-5">
          <h3 className="font-bold text-foreground">Transport</h3>
          <div className="mt-2 space-y-2">
            {bundle.transport.map((booking) => (
              <div key={booking.id} className="rounded-control border border-border bg-background p-3 text-caption">
                <p className="font-bold text-foreground">{booking.transporter} · {booking.status}</p>
                <p className="mt-1 text-muted-foreground">{booking.pickup_location} → {booking.destination}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {bundle.handover ? (
        <p className="mt-5 rounded-control border border-ok/30 bg-ok/10 p-3 text-caption font-semibold text-foreground">
          Physical handover recorded {formatDateTime(bundle.handover.handed_over_at)} · evidence {bundle.handover.evidence_reference}
        </p>
      ) : null}

      {role === "seller" ? (
        <p className="mt-5 text-caption text-muted-foreground">
          Seller settlement/payout: <strong className="text-foreground">{s.seller_payout_state ?? "FINANCE_PENDING"}</strong>. Buyer financial details remain outside this seller view.
        </p>
      ) : null}
    </section>
  );
}
