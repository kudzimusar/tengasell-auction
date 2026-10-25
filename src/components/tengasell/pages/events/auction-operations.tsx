"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Gavel,
  RefreshCw,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/tengasell/auth";
import { rpc } from "@/lib/tengasell/socket";
import { EmptyState, ErrorState, StatusPill } from "@/components/tengasell/ui";

type Workbench = {
  ok: boolean;
  tasks: any[];
  overdueTasks: any[];
  qualificationQueue: any[];
  paymentQueue: any[];
  transferQueue: any[];
  releaseQueue: any[];
  transportQueue: any[];
  alerts: any[];
  events: any[];
};

type CalendarItem = {
  key: string;
  type: string;
  at: string;
  title: string;
  status: string;
  entityType: string;
  entityId: number;
};

function countLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export default function AuctionOperationsPage() {
  const { user, loading: authLoading } = useAuth();
  const [workbench, setWorkbench] = useState<Workbench | null>(null);
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [work, cal] = await Promise.all([
        rpc<{ ok: boolean } & Workbench>("operations:workbench", {}),
        rpc<{ ok: boolean; items: CalendarItem[] }>("operations:calendar", {}),
      ]);
      setWorkbench(work);
      setCalendar(cal.items ?? []);
    } catch (cause) {
      setWorkbench(null);
      setError(cause instanceof Error ? cause.message : "Auction operations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading && user) void load();
  }, [authLoading, user, load]);

  const completeTask = async (task: any) => {
    setError(null);
    try {
      await rpc("operations:task-command", {
        commandId: `ui-complete:${task.id}:${Date.now()}`,
        taskId: Number(task.id),
        commandType: "COMPLETE",
        reason: "Completed from Auction Operations workbench",
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Task could not be completed.");
    }
  };

  if (authLoading) {
    return <div className="mx-auto max-w-7xl px-4 py-8 text-body text-muted-foreground">Loading operator identity…</div>;
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <EmptyState
          icon={<ShieldCheck className="size-10" aria-hidden="true" />}
          title="Sign in for auction operations"
          body="Operator queues are available only to authenticated staff with a scoped auction capability."
          action={<Button asChild><a href="#/signin">Sign in</a></Button>}
        />
      </div>
    );
  }

  if (error && !workbench) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <ErrorState message={error} onRetry={load} />
        <p className="mt-3 text-caption text-muted-foreground">
          If your account is valid but access is denied, an administrator must grant the appropriate auction operations capability.
        </p>
      </div>
    );
  }

  const work = workbench ?? {
    ok: true,
    tasks: [],
    overdueTasks: [],
    qualificationQueue: [],
    paymentQueue: [],
    transferQueue: [],
    releaseQueue: [],
    transportQueue: [],
    alerts: [],
    events: [],
  };

  const queueCards = [
    { label: "Qualification", count: work.qualificationQueue.length, icon: ShieldCheck },
    { label: "Payment", count: work.paymentQueue.length, icon: CreditCard },
    { label: "Transfer", count: work.transferQueue.length, icon: ClipboardCheck },
    { label: "Release", count: work.releaseQueue.length, icon: CheckCircle2 },
    { label: "Transport", count: work.transportQueue.length, icon: Truck },
    { label: "Overdue", count: work.overdueTasks.length, icon: AlertTriangle },
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="rounded-card border border-border bg-raised p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-teal">
              <Gavel className="size-5" aria-hidden="true" />
              <span className="text-caption font-bold uppercase tracking-[0.16em]">Auction operations</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">Operator Workbench</h1>
            <p className="mt-1 max-w-3xl text-body text-muted-foreground">
              Tasks, qualification, settlement, transfer, release and transport are projected from their authoritative business records.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" className="min-h-11"><a href="#/events">Auction Hub</a></Button>
            <Button variant="outline" className="min-h-11" disabled={loading} onClick={() => void load()}>
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      {error ? <ErrorState message={error} onRetry={load} /> : null}

      <section aria-label="Operations queues" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {queueCards.map(({ label, count, icon: Icon }) => (
          <article key={label} className="rounded-card border border-border bg-raised p-4">
            <div className="flex items-center justify-between gap-2">
              <Icon className="size-5 text-teal" aria-hidden="true" />
              {count > 0 ? <StatusPill tone={label === "Overdue" ? "danger" : "warn"}>{count}</StatusPill> : <StatusPill tone="good">0</StatusPill>}
            </div>
            <p className="mt-3 text-bodyStrong font-bold text-foreground">{label}</p>
            <p className="text-caption text-muted-foreground">{countLabel(count, "item")}</p>
          </article>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="operations-tasks" className="rounded-card border border-border bg-raised p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 id="operations-tasks" className="text-lg font-bold text-foreground">Tasks</h2>
              <p className="text-caption text-muted-foreground">Work that must be done; not notifications.</p>
            </div>
            <StatusPill tone={work.overdueTasks.length ? "danger" : "muted"}>
              {work.overdueTasks.length} overdue
            </StatusPill>
          </div>
          <div className="space-y-2">
            {work.tasks.filter((task) => !["DONE", "CANCELLED"].includes(String(task.status))).slice(0, 20).map((task) => (
              <article key={task.id} className="rounded-control border border-border bg-background p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-foreground">{String(task.task_type).replaceAll("_", " ")}</p>
                      <StatusPill tone={task.status === "BLOCKED" ? "danger" : task.status === "IN_PROGRESS" ? "info" : "warn"}>
                        {task.status}
                      </StatusPill>
                      <StatusPill tone={task.priority === "URGENT" ? "danger" : "muted"}>{task.priority}</StatusPill>
                    </div>
                    <p className="mt-1 text-caption text-muted-foreground">
                      {task.entity_type} #{task.entity_id}
                      {task.due_at ? ` · due ${new Date(task.due_at).toLocaleString("en-GB")}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="min-h-11 shrink-0"
                    onClick={() => void completeTask(task)}
                    disabled={loading}
                  >
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    Complete
                  </Button>
                </div>
              </article>
            ))}
            {!work.tasks.length ? <p className="py-8 text-center text-body text-muted-foreground">No operational tasks in your queue.</p> : null}
          </div>
        </section>

        <section aria-labelledby="operations-calendar" className="rounded-card border border-border bg-raised p-4">
          <div className="mb-4 flex items-center gap-2">
            <CalendarDays className="size-5 text-teal" aria-hidden="true" />
            <div>
              <h2 id="operations-calendar" className="text-lg font-bold text-foreground">Calendar projection</h2>
              <p className="text-caption text-muted-foreground">Read-only projection from events, deadlines and transport.</p>
            </div>
          </div>
          <div className="space-y-2">
            {calendar.slice(0, 14).map((item) => (
              <article key={item.key} className="rounded-control border border-border bg-background p-3">
                <p className="text-caption font-bold uppercase tracking-wide text-teal">{item.type.replaceAll("_", " ")}</p>
                <p className="mt-1 font-semibold text-foreground">{item.title}</p>
                <p className="mt-1 text-caption text-muted-foreground">{new Date(item.at).toLocaleString("en-GB")} · {item.status}</p>
              </article>
            ))}
            {!calendar.length ? <p className="py-8 text-center text-body text-muted-foreground">No projected calendar items.</p> : null}
          </div>
        </section>
      </div>

      <section aria-labelledby="operations-alerts" className="rounded-card border border-border bg-raised p-4">
        <h2 id="operations-alerts" className="text-lg font-bold text-foreground">Exceptions</h2>
        <p className="mt-1 text-caption text-muted-foreground">Each exception states what is blocked and which capability can resolve it.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {work.alerts.map((alert) => (
            <article key={alert.id} className="rounded-control border border-urgent/30 bg-urgent/5 p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-urgent" aria-hidden="true" />
                <p className="font-bold text-foreground">{String(alert.alert_type).replaceAll("_", " ")}</p>
                <StatusPill tone="danger">{alert.severity}</StatusPill>
              </div>
              <p className="mt-2 text-body text-foreground">{alert.action_required}</p>
              <p className="mt-1 text-caption text-muted-foreground">
                Blocks {String(alert.blocked_action).replaceAll("_", " ")} · resolver {alert.resolver_capability ?? "operator"}
              </p>
            </article>
          ))}
          {!work.alerts.length ? <p className="py-6 text-body text-muted-foreground">No open operational exceptions.</p> : null}
        </div>
      </section>
    </main>
  );
}
