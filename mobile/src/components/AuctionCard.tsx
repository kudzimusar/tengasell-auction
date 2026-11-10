// Temu-style listing card, reskinned to TengaSell tokens.
// Sold/ended items carry a red diagonal band across the image — the strong
// "this is gone" signal requested for the mobile surface.

import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { formatRemaining, formatUSD } from "../lib/format";
import type { AuctionView } from "../lib/types";
import { useNxs } from "../nxs/context/NxsProvider";

interface Props {
  item: AuctionView;
  width: number;
  now: number;
  onPress: () => void;
}

export function AuctionCard({ item, width, now, onPress }: Props) {
  const { theme } = useNxs();
  const styles = useMemo(() => makeStyles(width), [width]);

  const remainingMs = Date.parse(item.ends_at) - now;
  // Status can lag the clock: a live record past its end time is closed, not
  // "Ends 0s". The card must never present an expired auction as biddable.
  const sold =
    item.status === "sold" ||
    item.status === "ended" ||
    item.status === "cancelled" ||
    remainingMs <= 0;
  const urgent = !sold && remainingMs > 0 && remainingMs < 3600_000;

  return (
    <Pressable hitSlop={4}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${formatUSD(item.current_price)}${
        sold ? ", sold" : `, ${item.bid_count} bids, ${formatRemaining(remainingMs)} left`
      }`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.imageWrap}>
        {item.imageList[0] ? (
          <Image source={{ uri: item.imageList[0] }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, { backgroundColor: theme.surface.raised }]} />
        )}

        {sold && (
          <>
            <View style={styles.soldVeil} pointerEvents="none" />
            <View style={styles.soldBandWrap} pointerEvents="none">
              <View style={styles.soldBand}>
                <Text style={styles.soldBandText}>SOLD</Text>
              </View>
            </View>
          </>
        )}

        {!sold && urgent && (
          <View style={styles.urgentChip}>
            <Text style={styles.urgentText}>{formatRemaining(remainingMs)}</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>

        <View style={styles.priceRow}>
          <Text style={[styles.price, sold && styles.priceSold]}>
            {formatUSD(item.current_price)}
          </Text>
          <Text style={styles.count}>{sold ? "sold" : `${item.bid_count} bids`}</Text>
        </View>

        <Text style={styles.meta} numberOfLines={1}>
          {sold ? "Auction closed" : `Ends ${formatRemaining(remainingMs)}`} · @{item.seller_username}
        </Text>
      </View>
    </Pressable>
  );
}

function makeStyles(width: number) {
  const cardWidth = width;
  return StyleSheet.create({
    card: {
      width: cardWidth,
      borderRadius: 14,
      backgroundColor: "#FFFFFF",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#E2E8EC",
      overflow: "hidden",
      marginBottom: 12,
    },
    imageWrap: { width: cardWidth, height: cardWidth, backgroundColor: "#F1F4F6" },
    image: { width: "100%", height: "100%" },

    // Red diagonal "SOLD" band
    soldVeil: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(10,13,16,0.34)",
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
      backgroundColor: "#D62828",
      borderTopWidth: 2,
      borderBottomWidth: 2,
      borderColor: "#FFFFFF",
      transform: [{ rotate: "-32deg" }],
      alignItems: "center",
    },
    soldBandText: {
      color: "#FFFFFF",
      fontWeight: "900",
      fontSize: 14,
      letterSpacing: 3,
    },

    urgentChip: {
      position: "absolute",
      left: 8,
      bottom: 8,
      backgroundColor: "rgba(214,40,40,0.92)",
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    urgentText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },

    body: { paddingHorizontal: 9, paddingTop: 8, paddingBottom: 10, gap: 3 },
    title: { fontSize: 12.5, lineHeight: 17, color: "#101619" },
    priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 2 },
    price: { fontSize: 17, fontWeight: "800", color: "#8A5F0B", letterSpacing: -0.4 },
    priceSold: { color: "#7A848A", textDecorationLine: "line-through" },
    count: { fontSize: 11, color: "#5C6B72" },
    meta: { fontSize: 10.5, color: "#7A8890" },
  });
}
