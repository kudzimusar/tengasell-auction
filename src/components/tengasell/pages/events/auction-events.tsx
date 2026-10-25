"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Gavel,
  ListOrdered,
  Lock,
  MapPin,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Unlock,
  UserPlus,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/tengasell/auth";
import { api } from "@/lib/tengasell/api";
import { useResource } from "@/lib/tengasell/hooks";
import { useRouter } from "@/lib/tengasell/router";
import type {
  AuctionEvent,
  AuctionLot,
  RunListCommandInput,
} from "@/lib/tengasell/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingGrid, StatusPill } from "@/components/tengasell/ui";

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTone(status: AuctionEvent["status"]): "good" | "warn" | "muted" | "danger" | "info" {
  if (status === "LIVE") return "good";
  if (status === "SCHEDULED") return "info";
  if (status === "CANCELLED") return "danger";
  if (status === "CLOSED") return "muted";
  return "warn";
}

export default function AuctionEventsPage({ eventId }: { eventId?: number }) {
  return eventId && Number.isFinite(eventId) ? <EventDetail eventId={eventId} /> : <AuctionHub />;
}

function AuctionHub() {
  const { user } = useAuth();
  const navigate = useRouter().navigate;
  const eventsRes = useResource(() => api.auctionEvents(), []);
  const events = eventsRes.data ?? [];
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [venueName, setVenueName] = useState("");
  const [venueCity, setVenueCity] = useState("Harare");

  const live = events.filter((event) => event.status === "LIVE");
  const upcoming = events.filter((event) => event.status === "SCHEDULED" || event.status === "DRAFT");
  const recent = events
    .filter((event) => event.status === "CLOSED" || event.status === "CANCELLED")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const calendarDays = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: 14 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() + index);
      const next = new Date(date);
      next.setDate(date.getDate() + 1);
      return {
        date,
        events: events.filter((event) => {
          const time = Date.parse(event.starts_at);
          return Number.isFinite(time) && time >= date.getTime() && time < next.getTime();
        }),
      };
    });
  }, [events]);

  const createEvent = async () => {
    if (!user) {
      navigate("/signin");
      return;
    }
    if (title.trim().length < 3) {
      setCreateError("Give the auction event a title.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const bundle = await api.createAuctionEvent({
        title: title.trim(),
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        timezone: "Africa/Harare",
        venue: venueName.trim()
          ? {
              name: venueName.trim(),
              city: venueCity.trim() || "Harare",
              country: "Zimbabwe",
              timezone: "Africa/Harare",
              venueType: "PHYSICAL",
            }
          : null,
      });
      if (!bundle.event) throw new Error("Event creation returned no event.");
      navigate(`/events/${bundle.event.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create the event.");
    } finally {
      setCreating(false);
    }
  };

  if (eventsRes.loading && !eventsRes.data) {
    return <div className="mx-auto max-w-7xl px-4 py-6"><LoadingGrid count={6} /></div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="rounded-card border border-border bg-raised p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-teal">
              <Gavel className="size-5" aria-hidden="true" />
              <span className="text-caption font-bold uppercase tracking-[0.16em]">Auction operations</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">Auction Hub</h1>
            <p className="mt-1 max-w-2xl text-body text-muted-foreground">
              Calendar, events, live sessions and production run lists share one TrailBase authority.
            </p>
          </div>
          <Button asChild variant="outline" className="min-h-11">
            <a href="#/live">
              <Radio className="size-4" aria-hidden="true" />
              Live rooms
            </a>
          </Button>
        </div>
      </header>

      {eventsRes.error ? <ErrorState message={eventsRes.error} onRetry={eventsRes.reload} /> : null}

      <section aria-labelledby="auction-calendar" className="rounded-card border border-border bg-raised p-4">
        <div className="mb-4 flex items-center gap-2">
          <CalendarDays className="size-5 text-teal" aria-hidden="true" />
          <h2 id="auction-calendar" className="text-lg font-bold text-foreground">Calendar</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {calendarDays.map(({ date, events: dayEvents }) => (
            <div key={date.toISOString()} className="min-h-28 rounded-control border border-border bg-background p-3">
              <p className="text-caption font-bold text-muted-foreground">
                {date.toLocaleDateString("en-GB", { weekday: "short" })}
              </p>
              <p className="text-xl font-bold text-foreground">{date.getDate()}</p>
              <div className="mt-2 space-y-1">
                {dayEvents.slice(0, 2).map((event) => (
                  <a
                    key={event.id}
                    href={`#/events/${event.id}`}
                    className="block truncate rounded px-1 py-1 text-[11px] font-semibold text-teal hover:bg-teal-tint"
                  >
                    {event.title}
                  </a>
                ))}
                {dayEvents.length > 2 ? (
                  <p className="text-[11px] text-muted-foreground">+{dayEvents.length - 2} more</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <EventGroup title="Live now" events={live} empty="No event is live right now." />
          <EventGroup title="Upcoming" events={upcoming} empty="No scheduled auction events." />
          {recent.length ? <EventGroup title="Recent" events={recent.slice(0, 8)} empty="" /> : null}
        </div>

        <aside className="rounded-card border border-border bg-raised p-4 lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center gap-2">
            <Plus className="size-5 text-teal" aria-hidden="true" />
            <h2 className="text-lg font-bold text-foreground">Create event</h2>
          </div>
          <p className="mt-1 text-caption text-muted-foreground">
            Creating an event creates its linked LiveSession automatically.
          </p>
          <div className="mt-4 space-y-3">
            <div>
              <Label htmlFor="event-title">Event title</Label>
              <Input id="event-title" value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 min-h-11" />
            </div>
            <div>
              <Label htmlFor="event-start">Starts</Label>
              <Input id="event-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="mt-1 min-h-11" />
            </div>
            <div>
              <Label htmlFor="event-venue">Venue (optional)</Label>
              <Input id="event-venue" value={venueName} onChange={(event) => setVenueName(event.target.value)} className="mt-1 min-h-11" placeholder="Harare Auction Centre" />
            </div>
            {venueName ? (
              <div>
                <Label htmlFor="event-city">City</Label>
                <Input id="event-city" value={venueCity} onChange={(event) => setVenueCity(event.target.value)} className="mt-1 min-h-11" />
              </div>
            ) : null}
            {createError ? <p role="alert" className="text-caption font-semibold text-danger">{createError}</p> : null}
            <Button onClick={createEvent} disabled={creating} className="min-h-11 w-full">
              <Gavel className="size-4" aria-hidden="true" />
              {creating ? "Creating…" : user ? "Create auction event" : "Sign in to create"}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function EventGroup({ title, events, empty }: { title: string; events: AuctionEvent[]; empty: string }) {
  return (
    <section aria-label={title} className="rounded-card border border-border bg-raised p-4">
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      {events.length === 0 ? (
        <p className="mt-3 text-body text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {events.map((event) => (
            <a
              key={event.id}
              href={`#/events/${event.id}`}
              className="rounded-card border border-border bg-background p-4 transition hover:border-teal/40 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="flex items-center gap-2">
                <StatusPill size="xs" tone={statusTone(event.status)}>{event.status}</StatusPill>
                <span className="ms-auto text-caption text-muted-foreground">v{event.run_list_version}</span>
              </div>
              <h3 className="mt-2 font-bold text-foreground">{event.title}</h3>
              <p className="mt-2 flex items-center gap-1.5 text-caption text-muted-foreground">
                <Clock3 className="size-3.5" aria-hidden="true" />
                {formatWhen(event.starts_at)}
              </p>
              <p className="mt-1 text-caption text-muted-foreground">Host: {event.host_username}</p>
              <span className="mt-3 inline-flex min-h-11 items-center gap-1 text-label font-bold text-teal">
                Open event <ArrowRight className="size-4" aria-hidden="true" />
              </span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function EventDetail({ eventId }: { eventId: number }) {
  const backHref = "#/events";
  const res = useResource(() => api.auctionEventBundle(eventId), [eventId]);
  const bundle = res.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auctionId, setAuctionId] = useState("");
  const [operator, setOperator] = useState("");
  const [operatorRole, setOperatorRole] = useState<"AUCTIONEER" | "CLERK">("AUCTIONEER");

  const reload = async () => {
    await res.reload();
  };

  const mutate = async (
    key: string,
    command: Omit<RunListCommandInput, "eventId" | "sessionId" | "expectedRunListVersion">,
  ) => {
    if (!bundle?.event || !bundle.session) return;
    setBusy(key);
    setError(null);
    try {
      await api.runListCommand({
        eventId: bundle.event.id,
        sessionId: bundle.session.id,
        expectedRunListVersion: bundle.event.run_list_version,
        commandId: globalThis.crypto.randomUUID(),
        ...command,
      });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Run-list command failed.");
      await reload();
    } finally {
      setBusy(null);
    }
  };

  if (res.loading && !bundle) {
    return <div className="mx-auto max-w-7xl px-4 py-6"><LoadingGrid count={5} /></div>;
  }
  if (res.error && !bundle) {
    return <div className="mx-auto max-w-7xl px-4 py-6"><ErrorState message={res.error} onRetry={res.reload} /></div>;
  }
  if (!bundle?.event || !bundle.session) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <EmptyState title="Auction event not found" body="This event is unavailable or no longer exposed." />
      </div>
    );
  }

  const { event, venue, session, lots, permissions } = bundle;
  const current = lots.find((lot) => lot.id === event.current_lot_id) ?? null;
  const next = lots.find((lot) => lot.id === event.next_lot_id) ?? null;
  const locked = event.run_list_locked === 1;

  const addAuction = async () => {
    const id = Number(auctionId);
    if (!Number.isInteger(id) || id <= 0) {
      setError("Enter a valid auction ID.");
      return;
    }
    await mutate("add", { commandType: "ADD", auctionId: id });
    setAuctionId("");
  };

  const assignOperator = async () => {
    if (!operator.trim()) return;
    setBusy("operator");
    setError(null);
    try {
      await api.grantEventOperator(event.id, operator.trim(), operatorRole);
      setOperator("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operator assignment failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <a href={backHref} className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 text-label font-bold text-teal hover:bg-teal-tint">
          <ArrowLeft className="size-4" aria-hidden="true" /> Auction Hub
        </a>
        <StatusPill size="xs" tone={statusTone(event.status)}>{event.status}</StatusPill>
        <span className="rounded-pill border border-border px-2 py-1 text-caption font-semibold text-muted-foreground">
          Run list v{event.run_list_version}
        </span>
        <span className={cn(
          "inline-flex items-center gap-1 rounded-pill px-2 py-1 text-caption font-semibold",
          locked ? "bg-warn/10 text-warn" : "bg-muted text-muted-foreground",
        )}>
          {locked ? <Lock className="size-3.5" aria-hidden="true" /> : <Unlock className="size-3.5" aria-hidden="true" />}
          {locked ? "Locked" : "Editable"}
        </span>
        <Button variant="ghost" className="ms-auto min-h-11" onClick={reload}>
          <RefreshCw className="size-4" aria-hidden="true" /> Refresh
        </Button>
      </div>

      <header className="rounded-card border border-border bg-raised p-5">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{event.title}</h1>
        <div className="mt-3 grid gap-3 text-caption text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
          <span><Clock3 className="me-1 inline size-4" aria-hidden="true" />{formatWhen(event.starts_at)}</span>
          <span><Gavel className="me-1 inline size-4" aria-hidden="true" />Host {event.host_username}</span>
          <span><ListOrdered className="me-1 inline size-4" aria-hidden="true" />{lots.filter((lot) => lot.status !== "WITHDRAWN").length} lots</span>
          {venue ? <span><MapPin className="me-1 inline size-4" aria-hidden="true" />{venue.name}{venue.city ? `, ${venue.city}` : ""}</span> : <span>Online / venue TBC</span>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild className="min-h-11">
            <a href={`#/live/${session.id}`}>
              <Radio className="size-4" aria-hidden="true" /> Open Live Room
            </a>
          </Button>
          {permissions.operate ? (
            <Button
              variant="outline"
              className="min-h-11"
              disabled={!!busy || (locked && !!event.current_lot_id)}
              onClick={() => mutate(locked ? "unlock" : "lock", { commandType: locked ? "UNLOCK" : "LOCK" })}
            >
              {locked ? <Unlock className="size-4" aria-hidden="true" /> : <Lock className="size-4" aria-hidden="true" />}
              {locked ? "Unlock run list" : "Lock run list"}
            </Button>
          ) : null}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-card border border-border bg-raised p-4">
          <p className="text-caption font-bold uppercase tracking-wide text-muted-foreground">Current lot</p>
          <p className="mt-2 text-bodyStrong font-bold text-foreground">
            {current?.auction ? `#${current.sequence_no} · ${current.auction.title}` : "No lot on the block"}
          </p>
          {current ? <p className="mt-1 text-caption text-muted-foreground">Lot #{current.id} · Auction #{current.auction_id}</p> : null}
        </div>
        <div className="rounded-card border border-border bg-raised p-4">
          <p className="text-caption font-bold uppercase tracking-wide text-muted-foreground">Next lot</p>
          <p className="mt-2 text-bodyStrong font-bold text-foreground">
            {next?.auction ? `#${next.sequence_no} · ${next.auction.title}` : "No ready next lot"}
          </p>
          {next ? <p className="mt-1 text-caption text-muted-foreground">Lot #{next.id} · Auction #{next.auction_id}</p> : null}
        </div>
      </section>

      {error ? (
        <div role="alert" className="rounded-control border border-danger/30 bg-danger/10 p-3 text-caption font-semibold text-danger">
          {error} The latest run-list version has been reloaded.
        </div>
      ) : null}

      {permissions.operate ? (
        <section aria-labelledby="operator-tools" className="rounded-card border border-border bg-raised p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-teal" aria-hidden="true" />
            <h2 id="operator-tools" className="text-lg font-bold text-foreground">Operator controls</h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <Label htmlFor="event-auction-id">Add auction ID</Label>
              <Input
                id="event-auction-id"
                inputMode="numeric"
                value={auctionId}
                onChange={(e) => setAuctionId(e.target.value)}
                disabled={locked}
                className="mt-1 min-h-11"
                placeholder="e.g. 1042"
              />
            </div>
            <Button onClick={addAuction} disabled={locked || !!busy} className="min-h-11 self-end">
              <Plus className="size-4" aria-hidden="true" /> Add to run list
            </Button>
          </div>

          {permissions.administer ? (
            <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-[minmax(0,1fr)_180px_auto]">
              <div>
                <Label htmlFor="event-operator">Operator username</Label>
                <Input id="event-operator" value={operator} onChange={(e) => setOperator(e.target.value)} className="mt-1 min-h-11" />
              </div>
              <div>
                <Label htmlFor="event-operator-role">Role</Label>
                <select
                  id="event-operator-role"
                  value={operatorRole}
                  onChange={(e) => setOperatorRole(e.target.value as "AUCTIONEER" | "CLERK")}
                  className="mt-1 min-h-11 w-full rounded-control border border-input bg-background px-3 text-sm"
                >
                  <option value="AUCTIONEER">Auctioneer</option>
                  <option value="CLERK">Clerk</option>
                </select>
              </div>
              <Button variant="outline" onClick={assignOperator} disabled={!operator.trim() || !!busy} className="min-h-11 self-end">
                <UserPlus className="size-4" aria-hidden="true" /> Assign
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="run-list" className="rounded-card border border-border bg-raised p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ListOrdered className="size-5 text-teal" aria-hidden="true" />
          <h2 id="run-list" className="text-lg font-bold text-foreground">Production Run List</h2>
          <span className="ms-auto text-caption text-muted-foreground">Durable sequence · optimistic concurrency</span>
        </div>

        {lots.length === 0 ? (
          <p className="mt-4 text-body text-muted-foreground">No lots have been assigned yet.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {lots
              .slice()
              .sort((a, b) => a.sequence_no - b.sequence_no || a.id - b.id)
              .map((lot, index, ordered) => (
                <RunListRow
                  key={lot.id}
                  lot={lot}
                  previous={ordered[index - 1] ?? null}
                  next={ordered[index + 1] ?? null}
                  locked={locked}
                  currentLotId={event.current_lot_id}
                  permissions={permissions.operate}
                  busy={busy}
                  mutate={mutate}
                />
              ))}
          </ol>
        )}
      </section>

      {permissions.operate && event.status !== "CLOSED" ? (
        <section className="rounded-card border border-border bg-raised p-4">
          <h2 className="font-bold text-foreground">Event lifecycle</h2>
          <p className="mt-1 text-caption text-muted-foreground">
            Closing returns queued/ready lots to their prior timed-listing authority. A live lot must be hammered or passed in the Live Room first.
          </p>
          <Button
            variant="outline"
            className="mt-3 min-h-11"
            disabled={!locked || !!event.current_lot_id || !!busy}
            onClick={() => mutate("close-event", { commandType: "CLOSE_EVENT" })}
          >
            <XCircle className="size-4" aria-hidden="true" /> Close auction event
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function RunListRow({
  lot,
  previous,
  next,
  locked,
  currentLotId,
  permissions,
  busy,
  mutate,
}: {
  lot: AuctionLot;
  previous: AuctionLot | null;
  next: AuctionLot | null;
  locked: boolean;
  currentLotId: number | null;
  permissions: boolean;
  busy: string | null;
  mutate: (
    key: string,
    command: Omit<RunListCommandInput, "eventId" | "sessionId" | "expectedRunListVersion">,
  ) => Promise<void>;
}) {
  const structural = lot.status === "QUEUED" || lot.status === "READY";
  const live = currentLotId === lot.id || lot.status === "LIVE";
  const disabled = !!busy;

  const withdraw = async () => {
    const reason = window.prompt("Withdrawal reason (required):", "");
    if (!reason) return;
    await mutate(`withdraw-${lot.id}`, { commandType: "WITHDRAW", lotId: lot.id, reason });
  };

  return (
    <li className={cn(
      "rounded-card border p-3",
      live ? "border-teal/50 bg-teal-tint" : lot.status === "WITHDRAWN" ? "border-border bg-muted/30 opacity-70" : "border-border bg-background",
    )}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-raised text-sm font-bold">
            {lot.sequence_no}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-bold text-foreground">{lot.auction?.title ?? `Auction #${lot.auction_id}`}</p>
              <StatusPill size="xs" tone={lot.status === "LIVE" ? "good" : lot.status === "READY" ? "info" : lot.status === "WITHDRAWN" ? "danger" : "muted"}>
                {lot.status}
              </StatusPill>
              {lot.auction?.asset_kind === "vehicle" ? (
                <span className="rounded-pill bg-teal/10 px-2 py-0.5 text-[11px] font-bold text-teal">Vehicle eligible</span>
              ) : null}
            </div>
            <p className="mt-1 text-caption text-muted-foreground">
              Lot #{lot.id} · Auction #{lot.auction_id} · lot version {lot.version}
            </p>
            {lot.withdrawal_reason ? <p className="mt-1 text-caption text-danger">{lot.withdrawal_reason}</p> : null}
          </div>
        </div>

        {permissions ? (
          <div className="flex flex-wrap gap-2">
            {structural && !locked ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  disabled={disabled || !previous || previous.status === "WITHDRAWN"}
                  onClick={() => mutate(`up-${lot.id}`, { commandType: "MOVE", lotId: lot.id, targetSequenceNo: Math.max(1, lot.sequence_no - 1) })}
                  aria-label={`Move lot ${lot.sequence_no} up`}
                >
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  disabled={disabled || !next || next.status === "WITHDRAWN"}
                  onClick={() => mutate(`down-${lot.id}`, { commandType: "MOVE", lotId: lot.id, targetSequenceNo: lot.sequence_no + 1 })}
                  aria-label={`Move lot ${lot.sequence_no} down`}
                >
                  <ArrowDown className="size-4" aria-hidden="true" />
                </Button>
                {lot.status === "QUEUED" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-10"
                    disabled={disabled}
                    onClick={() => mutate(`ready-${lot.id}`, { commandType: "READY", lotId: lot.id })}
                  >
                    <CheckCircle2 className="size-4" aria-hidden="true" /> Ready
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" className="min-h-10" disabled={disabled} onClick={withdraw}>
                  <XCircle className="size-4" aria-hidden="true" /> Withdraw
                </Button>
              </>
            ) : null}
            {lot.status === "READY" && locked && currentLotId == null ? (
              <Button
                size="sm"
                className="min-h-10"
                disabled={disabled}
                onClick={() => mutate(`open-${lot.id}`, { commandType: "OPEN", lotId: lot.id })}
              >
                <Gavel className="size-4" aria-hidden="true" /> Open lot
              </Button>
            ) : null}
            {live ? (
              <Button asChild size="sm" className="min-h-10">
                <a href={`#/live/${lot.session_id}`}>
                  <Radio className="size-4" aria-hidden="true" /> Live controls
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
