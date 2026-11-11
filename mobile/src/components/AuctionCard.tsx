// Temu-style listing card, built on NXS semantic tokens and localized copy.
// Sold/ended items carry a diagonal band across the image so closed listings
// cannot be misread as biddable.

import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { formatRemaining, formatUSD } from "../lib/format";
import type { AuctionView } from "../lib/types";
import { useNxs } from "../nxs/context/NxsProvider";
import { useNxsText } from "../nxs/localization/useNxsText";
import { nxsTokens, type NxsTheme } from "../nxs/tokens";

interface Props {
  item: AuctionView;
  width: number;
  now: number;
  onPress: () => void;
}

export function AuctionCard({ item, width, now, onPress }: Props) {
  const { theme, writingDirection } = useNxs();
  const t = useNxsText();
  const styles = useMemo(
    () => makeStyles(theme, width, writingDirection),
    [theme, width, writingDirection],
  );

  const endsMs = Date.parse(item.ends_at);
  const remainingMs = Number.isFinite(endsMs) ? endsMs - now : 0;
  // Status can lag the clock, and malformed timestamps fail closed as sold/closed.
  const sold =
    item.status === "sold" ||
    item.status === "ended" ||
    item.status === "cancelled" ||
    !Number.isFinite(endsMs) ||
    remainingMs <= 0;
  const urgent = !sold && remainingMs > 0 && remainingMs < 3600_000;
  const priceLabel = formatUSD(item.current_price);
  const remainingLabel = formatRemaining(Math.max(0, remainingMs));
  const statusText = sold
    ? t("auction.closedLabel")
    : t("auction.endsRemaining", { remaining: remainingLabel });

  return (
    <Pressable
      hitSlop={4}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        sold
          ? t("auction.cardSummarySold", { title: item.title, price: priceLabel })
          : t("auction.cardSummaryLive", {
              title: item.title,
              price: priceLabel,
              count: item.bid_count,
              remaining: remainingLabel,
            })
      }
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.imageWrap}>
        {item.imageList[0] ? (
          <Image source={{ uri: item.imageList[0] }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]} />
        )}

        {sold && (
          <>
            <View style={styles.soldVeil} pointerEvents="none" />
            <View style={styles.soldBandWrap} pointerEvents="none">
              <View style={styles.soldBand}>
                <Text style={styles.soldBandText}>{t("auction.soldBadge")}</Text>
              </View>
            </View>
          </>
        )}

        {!sold && urgent && (
          <View style={styles.urgentChip}>
            <Text style={styles.urgentText}>{remainingLabel}</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>

        <View style={styles.priceRow}>
          <Text style={[styles.price, sold && styles.priceSold]}>{priceLabel}</Text>
          <Text style={styles.count}>
            {sold
              ? t("auction.soldStatus")
              : t("auction.bidCount", { count: item.bid_count })}
          </Text>
        </View>

        <Text style={styles.meta} numberOfLines={1}>
          {t("auction.cardMeta", {
            statusText,
            seller: item.seller_username,
          })}
        </Text>
      </View>
    </Pressable>
  );
}

function makeStyles(theme: NxsTheme, width: number, writingDirection: "ltr" | "rtl") {
  const cardWidth = Math.max(nxsTokens.touch.minimum, width);
  const textAlign = writingDirection === "rtl" ? "right" : "left";
  const rowDirection = writingDirection === "rtl" ? "row-reverse" : "row";

  return StyleSheet.create({
    card: {
      width: cardWidth,
      minHeight: nxsTokens.touch.minimum,
      borderRadius: nxsTokens.radius.card,
      backgroundColor: theme.surface.raised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.subtle,
      overflow: "hidden",
      marginBottom: 12,
    },
    pressed: { opacity: 0.85 },
    imageWrap: {
      width: cardWidth,
      height: cardWidth,
      backgroundColor: theme.surface.overlay,
    },
    image: { width: "100%", height: "100%" },
    imagePlaceholder: { backgroundColor: theme.surface.overlay },

    soldVeil: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.surface.scrim,
    },
    soldBandWrap: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    soldBand: {
      width: cardWidth * 1.35,
      paddingVertical: 6,
      backgroundColor: theme.state.error,
      borderTopWidth: 2,
      borderBottomWidth: 2,
      borderColor: theme.text.inverse,
      transform: [{ rotate: "-32deg" }],
      alignItems: "center",
    },
    soldBandText: {
      color: theme.text.inverse,
      fontWeight: "900",
      fontSize: 14,
      letterSpacing: 3,
    },

    urgentChip: {
      position: "absolute",
      ...(writingDirection === "rtl" ? { right: 8 } : { left: 8 }),
      bottom: 8,
      backgroundColor: theme.state.error,
      borderRadius: nxsTokens.radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    urgentText: { color: theme.text.inverse, fontSize: 11, fontWeight: "700" },

    body: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 4 },
    title: { fontSize: 13, lineHeight: 18, color: theme.text.primary, textAlign },
    priceRow: {
      flexDirection: rowDirection,
      alignItems: "baseline",
      gap: 6,
      marginTop: 2,
    },
    price: {
      fontSize: 17,
      fontWeight: "800",
      color: theme.state.warning,
      letterSpacing: -0.4,
      textAlign,
    },
    priceSold: { color: theme.state.disabled, textDecorationLine: "line-through" },
    count: { fontSize: 12, color: theme.text.secondary, textAlign },
    meta: { fontSize: 11, color: theme.text.secondary, textAlign },
  });
}
