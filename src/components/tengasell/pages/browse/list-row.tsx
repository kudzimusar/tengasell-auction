"use client";

// Tengasell browse — compact horizontal result row (list view). Shows image,
// title, condition, bids, price, buy-now hint, countdown, seller and city.
// Yahoo-style countdown turns urgent in the final minutes.

import { motion, useReducedMotion } from "framer-motion";
import { Truck } from "lucide-react";
import { Avatar, Countdown, PriceTag } from "@/components/tengasell/ui";
import { conditionLabel, formatUSD } from "@/lib/tengasell/format";
import { useLinkProps } from "@/lib/tengasell/router";
import { toAuctionView, type Auction } from "@/lib/tengasell/types";

export function ListRow({ auction: raw }: { auction: Auction }) {
  const a = toAuctionView(raw);
  const link = useLinkProps(`/item/${a.id}`);
  const reduced = useReducedMotion();
  const img = a.imageList[0] ?? "/brand/hero-main.png";

  return (
    <motion.a
      {...link}
      whileHover={reduced ? undefined : { y: -2 }}
      whileTap={reduced ? undefined : { scale: 0.99 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="group flex gap-3 sm:gap-4 p-3 sm:p-4 rounded-card border border-border bg-raised overflow-hidden hover:border-teal/40 hover:shadow-md transition-colors focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`${a.title}, current price ${formatUSD(a.current_price)}, ${a.bid_count} bids`}
    >
      <div className="relative w-24 h-24 sm:w-36 sm:h-28 shrink-0 rounded-input overflow-hidden bg-muted">
        <img
          src={img}
          alt={a.title}
          loading="lazy"
          className="size-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
        />
        <div className="absolute top-1 start-1 flex flex-col gap-1">
          {a.endingSoon && a.status === "live" && (
            <span className="rounded-full bg-urgent text-white text-[10px] font-bold px-1.5 py-0.5 uppercase tracking-wide">
              Ending
            </span>
          )}
          {a.extension_count > 0 && (
            <span className="rounded-full bg-teal text-white text-[10px] font-bold px-1.5 py-0.5 uppercase tracking-wide">
              Ext
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <h3 className="text-body sm:text-bodyStrong text-foreground leading-snug line-clamp-2 group-hover:text-teal transition-colors">
          {a.title}
        </h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
          <span className="truncate">{conditionLabel(a.condition)}</span>
          <span aria-hidden="true">·</span>
          <span className="ts-numeric">
            {a.bid_count} bid{a.bid_count === 1 ? "" : "s"}
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{a.city}</span>
          {a.shipping_fee === 0 && (
            <span className="inline-flex items-center gap-0.5 text-ok font-semibold">
              <Truck className="size-3" aria-hidden="true" />
              Free shipping
            </span>
          )}
        </div>
        <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-1">
          <PriceTag amount={a.current_price} size="sm" tone="teal" />
          <span className="flex items-baseline gap-2">
            {a.buy_now_price != null && a.bid_count === 0 && (
              <span className="text-caption text-gold-deep font-semibold ts-numeric">
                Buy now {formatUSD(a.buy_now_price)}
              </span>
            )}
            {a.reserve_price != null && a.reserveMet === false && (
              <span className="text-caption text-warn font-semibold">
                Reserve not met
              </span>
            )}
            {a.status === "live" ? (
              <Countdown endsAt={a.ends_at} className="text-caption" />
            ) : (
              <span className="text-caption text-muted-foreground uppercase">
                {a.status}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-caption text-muted-foreground pt-0.5">
          <Avatar username={a.seller_username} size={16} />
          <span className="truncate">@{a.seller_username}</span>
        </div>
      </div>
    </motion.a>
  );
}
