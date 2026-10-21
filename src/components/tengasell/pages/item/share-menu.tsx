"use client";

// Tengasell item share menu (Task 11-d) — popover with the four social
// share targets (WhatsApp / Telegram / Facebook / X) plus a copy-link row.
//
// Contract:
//   · share URLs are EXTERNAL services (allowed — they are not our ports):
//       WhatsApp  https://wa.me/?text=…
//       Telegram  https://t.me/share/url?url=…&text=…
//       Facebook  https://www.facebook.com/sharer/sharer.php?u=…
//       X         https://twitter.com/intent/tweet?url=…&text=…
//   · payload = item title + the app's own hash deep link (#/item/{id})
//   · 44px minimum touch targets, teal/gold NXS palette only, lucide icons,
//     full keyboard access (focus-visible rings), i18n in en + ja.

import { useState } from "react";
import { Check, Copy, Facebook, MessageCircle, Send, Share2, Twitter } from "lucide-react";
import { useI18n } from "@/lib/tengasell/i18n";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ShareMenuProps {
  auctionId: number;
  title: string;
  /** button size variant to match the sibling Watch / Ask buttons */
  className?: string;
}

/** The app's absolute URL for one auction (hash deep link, no port hardcoding). */
export function auctionShareUrl(auctionId: number): string {
  if (typeof window === "undefined") return `#/item/${auctionId}`;
  return `${window.location.origin}${window.location.pathname}#/item/${auctionId}`;
}

interface ShareTarget {
  key: "whatsapp" | "telegram" | "facebook" | "x";
  href: string;
  icon: React.ReactNode;
}

export function ShareMenu({ auctionId, title, className }: ShareMenuProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const url = auctionShareUrl(auctionId);
  const encTitle = encodeURIComponent(title);
  const encUrl = encodeURIComponent(url);

  const targets: ShareTarget[] = [
    {
      key: "whatsapp",
      href: `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
      icon: <MessageCircle className="size-4 text-teal" aria-hidden="true" />,
    },
    {
      key: "telegram",
      href: `https://t.me/share/url?url=${encUrl}&text=${encTitle}`,
      icon: <Send className="size-4 text-teal" aria-hidden="true" />,
    },
    {
      key: "facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encUrl}`,
      icon: <Facebook className="size-4 text-teal" aria-hidden="true" />,
    },
    {
      key: "x",
      href: `https://twitter.com/intent/tweet?url=${encUrl}&text=${encTitle}`,
      icon: <Twitter className="size-4 text-teal" aria-hidden="true" />,
    },
  ];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: t("share.copied"), description: t("share.copiedBody") });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: t("share.copyFailed"), description: url, variant: "destructive" });
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-haspopup="dialog"
          className={cn("min-h-11 rounded-control", className)}
        >
          <Share2 className="size-4" aria-hidden="true" />
          <span className="truncate">{t("share.trigger")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-64 p-2 rounded-card"
        aria-label={t("share.title")}
      >
        <p className="px-3 pt-1 pb-2 text-label font-bold text-foreground">{t("share.title")}</p>
        <ul className="space-y-1" role="list">
          {targets.map((target) => (
            <li key={target.key} role="listitem">
              <a
                href={target.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 min-h-11 px-3 rounded-control text-body text-foreground hover:bg-teal-tint transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {target.icon}
                <span className="flex-1 truncate">{t(`share.${target.key}`)}</span>
                <span className="text-caption text-muted-foreground" aria-hidden="true">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
        <div className="my-1 h-px bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={copyLink}
          className="flex w-full items-center gap-3 min-h-11 px-3 rounded-control text-body text-foreground hover:bg-teal-tint transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {copied ? (
            <Check className="size-4 text-gold-deep" aria-hidden="true" />
          ) : (
            <Copy className="size-4 text-teal" aria-hidden="true" />
          )}
          <span className="flex-1 truncate text-left">{t("share.copy")}</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
