"use client";

// Admin Comms Console — MODERATION QUEUE: relay_log items held at
// status=review with from→to, thread id, timestamp, flags chips and the
// contentOriginal vs maskedContent side-by-side diff. Approve delivers the
// held message; Block drops it. Toasts on both; "Queue is clear" empty state.

import { useState } from "react";
import { Check, Loader2, RefreshCw, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, SectionHeader } from "@/components/tengasell/ui";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatRelative } from "@/lib/tengasell/format";
import {
  AdminChip,
  commsAdminFetch,
  flagLabel,
  modFlagTone,
  type ModItem,
} from "./console-shared";

export function ConsoleModeration({ token }: { token: string }) {
  const { t } = useI18n();
  const queue = useResource<ModItem[]>(
    async () => {
      const data = await commsAdminFetch<{ items?: ModItem[] }>(
        token,
        "/moderation?status=review",
      );
      return data.items ?? [];
    },
    [token],
  );

  const [busyId, setBusyId] = useState<number | null>(null);
  const [blockTarget, setBlockTarget] = useState<ModItem | null>(null);

  const act = async (item: ModItem, action: "approve" | "block") => {
    setBusyId(item.id);
    try {
      await commsAdminFetch(token, `/moderation/${item.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      toast({
        title: action === "approve" ? t("admin.mod.approveToast") : t("admin.mod.blockToast"),
      });
      queue.reload();
    } catch (err) {
      toast({
        title: t("admin.actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const items = queue.data ?? [];

  return (
    <section aria-labelledby="admin-mod-heading" className="min-w-0 space-y-6">
      <SectionHeader
        title={<span id="admin-mod-heading">{t("admin.mod.title")}</span>}
        subtitle={t("admin.mod.sub")}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-label text-muted-foreground">
          {t("admin.mod.pending")} · <span className="ts-numeric font-bold text-foreground">{items.length}</span>
        </p>
        <Button variant="outline" className="min-h-11" onClick={queue.reload}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t("admin.refresh")}
        </Button>
      </div>

      {queue.error ? (
        <ErrorState message={queue.error} onRetry={queue.reload} />
      ) : queue.loading && !queue.data ? (
        <div className="space-y-4" aria-busy="true" aria-label={t("admin.mod.title")}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-card border border-border bg-raised p-4 space-y-3">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert className="size-10" />}
          title={t("admin.mod.empty")}
          body={t("admin.mod.emptyBody")}
        />
      ) : (
        <ul className="list-none p-0 m-0 space-y-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-card border border-warn/40 bg-raised p-4 sm:p-5 space-y-4"
            >
              {/* header: from → to, thread, time */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <p className="text-label font-bold text-foreground">
                  <span className="text-teal-deep">{item.fromUserId ?? "—"}</span>
                  <span className="mx-1.5 text-muted-foreground" aria-hidden="true">→</span>
                  <span className="text-gold-deep">{item.toUserId ?? "—"}</span>
                </p>
                <AdminChip tone={item.direction === "in" ? "teal" : "gold"} label={item.direction}>
                  {item.direction === "in" ? t("admin.mod.inbound") : t("admin.mod.outbound")}
                </AdminChip>
                <span className="text-caption text-muted-foreground ts-numeric truncate">
                  {t("admin.mod.thread")}: {item.threadId ?? "—"}
                </span>
                <span className="ms-auto text-caption text-muted-foreground shrink-0">
                  {item.createdAt ? formatRelative(item.createdAt) : ""}
                </span>
              </div>

              {/* flags */}
              {item.flags.length > 0 && (
                <div className="flex flex-wrap gap-1.5" aria-label={t("admin.mod.flags")}>
                  {item.flags.map((f, i) => (
                    <AdminChip key={i} tone={modFlagTone(f)}>
                      {flagLabel(f)}
                    </AdminChip>
                  ))}
                </div>
              )}

              {/* original vs masked side-by-side */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-control border border-border bg-canvas p-3">
                  <p className="text-caption font-bold text-muted-foreground mb-1">
                    {t("admin.mod.original")}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-body text-foreground">
                    {item.contentOriginal ?? "—"}
                  </p>
                </div>
                <div className="rounded-control border border-warn/40 bg-warn/5 p-3">
                  <p className="text-caption font-bold text-muted-foreground mb-1">
                    {t("admin.mod.masked")}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-body text-foreground">
                    {item.maskedContent ?? item.contentOriginal ?? "—"}
                  </p>
                </div>
              </div>

              {/* actions */}
              <div className="flex flex-wrap gap-2">
                <Button
                  className="min-h-11 font-bold"
                  disabled={busyId === item.id}
                  onClick={() => act(item, "approve")}
                >
                  {busyId === item.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="size-4" aria-hidden="true" />
                  )}
                  {t("admin.mod.approve")}
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11 border-danger/50 text-danger hover:bg-danger/10 hover:text-danger"
                  disabled={busyId === item.id}
                  onClick={() => setBlockTarget(item)}
                >
                  <X className="size-4" aria-hidden="true" />
                  {t("admin.mod.block")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* block confirm */}
      <AlertDialog
        open={blockTarget != null}
        onOpenChange={(open) => {
          if (!open) setBlockTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.mod.blockTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.mod.blockBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                if (blockTarget) void act(blockTarget, "block");
                setBlockTarget(null);
              }}
            >
              <X className="size-4" aria-hidden="true" />
              {t("admin.mod.block")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
