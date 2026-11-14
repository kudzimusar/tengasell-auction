"use client";

// Client-side auction subscription helpers (UX-01 R3A).
// Manages first-party in-app reminders for events, lots, and auctions.
// Talks to /api/comms/subscriptions with Bearer token authentication.

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/tengasell/auth";

export type SubscriptionTargetType = "event" | "lot" | "auction";

export interface ClientSubscription {
  id: number;
  userId: string;
  targetType: SubscriptionTargetType;
  targetId: string;
  eventId: number | null;
  lotId: number | null;
  sessionId: number | null;
  auctionId: number | null;
  title: string;
  startsAt: string | null;
  status: "active" | "unsubscribed";
  channels: string[];
  notify24h: boolean;
  notify1h: boolean;
  notifyLive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

const LOCAL_STORAGE_KEY = "tgs_r3a_local_subs_v1";
const SYNC_EVENT = "tgs:subscriptions:sync";

function getLocalSubs(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setLocalSub(key: string, active: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const current = getLocalSubs();
    if (active) {
      current[key] = true;
    } else {
      delete current[key];
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { key, active } }));
  } catch {
    // ignore
  }
}

export function useAuctionSubscription(
  targetType: SubscriptionTargetType,
  targetId: string | number | null | undefined,
  metadata?: {
    title?: string | null;
    eventId?: number | null;
    lotId?: number | null;
    sessionId?: number | null;
    auctionId?: number | null;
    startsAt?: string | null;
  },
) {
  const { user } = useAuth();
  const idStr = targetId != null ? String(targetId).trim() : "";
  const key = `${targetType}:${idStr}`;

  const [subscribed, setSubscribed] = useState<boolean>(() => {
    if (!idStr) return false;
    return Boolean(getLocalSubs()[key]);
  });
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    if (!user?.token || !idStr) {
      return;
    }
    fetch("/api/comms/subscriptions", {
      headers: {
        Authorization: `Bearer ${user.token}`,
      },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const active = (data.subscriptions as ClientSubscription[] | undefined)?.some(
          (s) => s.targetType === targetType && String(s.targetId) === idStr && s.status === "active",
        );
        const isSub = Boolean(active);
        setSubscribed(isSub);
        setLocalSub(key, isSub);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, idStr, targetType, key]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ key: string; active: boolean }>;
      if (custom.detail && custom.detail.key === key) {
        setSubscribed(custom.detail.active);
      }
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, [key]);

  const toggle = useCallback(
    async (options?: { notify24h?: boolean; notify1h?: boolean; notifyLive?: boolean }) => {
      if (!idStr) return { ok: false, error: "Missing target ID" };
      setLoading(true);
      const next = !subscribed;
      try {
        if (!user?.token) {
          setLocalSub(key, next);
          setSubscribed(next);
          return { ok: true, subscribed: next, guest: true };
        }

        if (next) {
          const res = await fetch("/api/comms/subscriptions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${user.token}`,
            },
            body: JSON.stringify({
              targetType,
              targetId: idStr,
              eventId: metadata?.eventId,
              lotId: metadata?.lotId,
              sessionId: metadata?.sessionId,
              auctionId: metadata?.auctionId,
              title: metadata?.title,
              startsAt: metadata?.startsAt,
              notify24h: options?.notify24h ?? true,
              notify1h: options?.notify1h ?? true,
              notifyLive: options?.notifyLive ?? true,
            }),
          });
          const data = await res.json();
          if (res.ok && data.ok) {
            setLocalSub(key, true);
            setSubscribed(true);
            return { ok: true, subscribed: true, confirmDispatched: data.confirmDispatched };
          }
          return { ok: false, error: data.error || "Subscription failed" };
        } else {
          const res = await fetch(
            `/api/comms/subscriptions?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(idStr)}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${user.token}`,
              },
            },
          );
          const data = await res.json();
          if (res.ok && data.ok) {
            setLocalSub(key, false);
            setSubscribed(false);
            return { ok: true, subscribed: false };
          }
          return { ok: false, error: data.error || "Unsubscribe failed" };
        }
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      } finally {
        setLoading(false);
      }
    },
    [idStr, subscribed, user, key, targetType, metadata],
  );

  return { subscribed, loading, toggle };
}
