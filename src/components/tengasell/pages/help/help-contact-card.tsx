"use client";

// Tengasell — Help contact card (help page contact section). Task 12-c.
// Signed in: quick ticket intake (category + subject + body → POST
// /api/trust/me/tickets) with a link to the full Support section.
// Signed out: prompt to sign in — the page's mailto stays available below.

import { useState } from "react";
import { LifeBuoy, Loader2, LogIn, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/tengasell/auth";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps } from "@/lib/tengasell/router";
import { trustFetch } from "../trust-client";

const CATEGORIES = ["question", "order", "refund", "complaint", "feedback", "other"] as const;

export function HelpContactCard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const signinLink = useLinkProps("/signin");
  const ticketsLink = useLinkProps("/my/tickets");

  if (!user) {
    return (
      <Card className="mt-4">
        <CardContent className="p-5 space-y-2">
          <p className="flex items-center gap-2 text-label font-bold text-foreground">
            <LifeBuoy className="size-4 text-teal" aria-hidden="true" />
            {t("support.intake.title")}
          </p>
          <p className="text-caption text-muted-foreground">{t("support.intake.signinBody")}</p>
          <Button asChild className="min-h-11 mt-2">
            <a {...signinLink}>
              <LogIn className="size-4" aria-hidden="true" />
              {t("nav.signin")}
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <IntakeCard token={user.token} ticketsLink={ticketsLink} />;
}

function IntakeCard({
  token,
  ticketsLink,
}: {
  token: string;
  ticketsLink: ReturnType<typeof useLinkProps>;
}) {
  const { t } = useI18n();
  const [category, setCategory] = useState<string>("question");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const valid = subject.trim().length >= 3 && body.trim().length >= 10;

  const submit = async () => {
    setBusy(true);
    try {
      const d = await trustFetch<{ ticket: { id: number } }>(token, "/me/tickets", {
        method: "POST",
        body: JSON.stringify({ category, subject, body }),
      });
      setDone(d.ticket.id);
      toast({ title: t("trust.ticket.created"), description: `#${d.ticket.id}` });
      setSubject("");
      setBody("");
    } catch (err) {
      toast({
        title: t("admin.actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-4">
      <CardContent className="p-5 space-y-3">
        <p className="flex items-center gap-2 text-label font-bold text-foreground">
          <LifeBuoy className="size-4 text-teal" aria-hidden="true" />
          {t("support.intake.title")}
        </p>
        <p className="text-caption text-muted-foreground">{t("support.intake.sla")}</p>

        {done != null ? (
          <div className="rounded-control border border-ok/30 bg-ok/10 p-3">
            <p className="text-label font-bold text-foreground">
              {t("support.intake.created")} #{done}
            </p>
            <a
              {...ticketsLink}
              className="inline-flex min-h-11 items-center text-label font-semibold text-teal-deep hover:underline"
            >
              {t("support.intake.viewThread")}
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="help-category">{t("trust.ticket.category")}</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="help-category" className="min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {t(`trust.category.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="help-subject">{t("trust.ticket.subject")}</Label>
                <Input
                  id="help-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                  placeholder={t("trust.ticket.subjectPlaceholder")}
                  className="min-h-11"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="help-body">{t("trust.ticket.body")}</Label>
              <Textarea
                id="help-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="min-h-24"
                placeholder={t("trust.ticket.bodyPlaceholder")}
              />
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <a
                {...ticketsLink}
                className="min-h-11 inline-flex items-center text-label font-semibold text-teal-deep hover:underline"
              >
                {t("support.intake.allTickets")}
              </a>
              <Button type="button" className="min-h-11" disabled={busy || !valid} onClick={() => void submit()}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                {t("trust.ticket.submit")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
