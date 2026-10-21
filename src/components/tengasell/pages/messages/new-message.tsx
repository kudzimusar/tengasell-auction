"use client";

// Tengasell new-message pane — #/messages?to={username} starts a direct
// conversation. Shows the recipient (profile lookup), a fixed "Direct
// message" subject, and the composer. Sending goes through
// api.sendMessage({toUsername, body}) and navigates to the thread it
// belongs to (creating it on first contact).

import { useState } from "react";
import { AtSign, ChevronLeft } from "lucide-react";
import { api } from "@/lib/tengasell/api";
import { useResource } from "@/lib/tengasell/hooks";
import { formatDateTime } from "@/lib/tengasell/format";
import { useLinkProps, useRouter } from "@/lib/tengasell/router";
import type { Profile } from "@/lib/tengasell/types";
import { toast } from "@/hooks/use-toast";
import { Avatar, ErrorState } from "@/components/tengasell/ui";
import { Composer } from "./composer";

export function NewMessage({ toUsername }: { toUsername: string }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);

  const profileRes = useResource<Profile | null>(
    () => (toUsername ? api.profile(toUsername) : Promise.resolve(null)),
    [toUsername],
  );

  const send = async (body: string): Promise<boolean> => {
    if (sending) return false;
    setSending(true);
    try {
      const { thread } = await api.sendMessage({ toUsername, body });
      toast({
        title: "Message sent",
        description: `Your conversation with @${toUsername} is ready.`,
      });
      router.navigate(`/messages/${thread.id}`);
      return true;
    } catch (err) {
      toast({
        title: "Message not sent",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setSending(false);
    }
  };

  const profileLink = useLinkProps(`/u/${toUsername}`);

  return (
    <section
      className="rounded-card border border-border bg-raised overflow-hidden flex flex-col"
      aria-label={`New message to ${toUsername}`}
    >
      {/* header */}
      <header className="flex items-center gap-2 p-3 border-b border-border">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back to messages"
          className="md:hidden size-11 -ms-1 shrink-0 grid place-items-center rounded-control hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-label font-bold text-foreground">New message</p>
          <a
            {...profileLink}
            className="text-caption text-teal hover:underline truncate inline-flex items-center gap-0.5 min-h-6"
          >
            <AtSign className="size-3.5 shrink-0" aria-hidden="true" />
            {toUsername}
          </a>
        </div>
      </header>

      {/* recipient card */}
      {profileRes.error ? (
        <div className="p-3 border-b border-border">
          <ErrorState message={profileRes.error} onRetry={profileRes.reload} />
        </div>
      ) : profileRes.loading ? (
        <div className="p-4 flex items-center gap-3 border-b border-border" aria-busy="true">
          <div className="size-10 rounded-full bg-muted animate-pulse shrink-0" />
          <div className="flex-1 space-y-1.5 min-w-0">
            <div className="h-3.5 w-28 bg-muted rounded animate-pulse" />
            <div className="h-3 w-44 bg-muted rounded animate-pulse" />
          </div>
        </div>
      ) : profileRes.data == null ? (
        <div className="p-3 border-b border-border">
          <ErrorState message={`@${toUsername} is not a Tengasell member yet — check the spelling and try again.`} />
        </div>
      ) : (
        <div className="p-4 flex items-center gap-3 border-b border-border bg-section/40">
          <Avatar username={profileRes.data.username} size={40} />
          <div className="min-w-0">
            <p className="text-label font-semibold text-foreground truncate">
              {profileRes.data.display_name || profileRes.data.username}
            </p>
            <p className="text-caption text-muted-foreground truncate">
              @{profileRes.data.username} · {profileRes.data.city || "Zimbabwe"} · member since{" "}
              {formatDateTime(profileRes.data.joined_at, { withTime: false })}
            </p>
          </div>
        </div>
      )}

      {/* subject */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-muted/30">
        <span className="text-caption text-muted-foreground shrink-0">Subject</span>
        <span className="text-body text-foreground truncate">Direct message</span>
      </div>

      <Composer onSend={send} sending={sending} placeholder={`Message @${toUsername}…`} autoFocus />
    </section>
  );
}
