// Shared two-column listing grid built on responsive NXS layout metrics.

import { useRouter } from "expo-router";
import { useMemo } from "react";
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { computeGridMetrics } from "../lib/grid-layout";
import type { AuctionView } from "../lib/types";
import { useNxs } from "../nxs/context/NxsProvider";
import { type NxsTheme } from "../nxs/tokens";
import { AuctionCard } from "./AuctionCard";

interface Props {
  items: AuctionView[];
  now: number;
  empty?: string;
  header?: React.ReactElement | null;
  contentPadding?: number;
}

export function ListingGrid({ items, now, empty, header, contentPadding }: Props) {
  const { width } = useWindowDimensions();
  const { theme, screenPadding, safeArea, writingDirection } = useNxs();
  const rowDirection = writingDirection === "rtl" ? "row-reverse" : "row";
  const router = useRouter();
  const padding = contentPadding ?? screenPadding;
  const metrics = useMemo(
    () =>
      computeGridMetrics({
        viewportWidth: width,
        columns: 2,
        padding,
        safeLeft: safeArea.left,
        safeRight: safeArea.right,
      }),
    [padding, safeArea.left, safeArea.right, width],
  );
  const styles = useMemo(
    () => makeStyles(theme, metrics.containerWidth, metrics.padding),
    [theme, metrics.containerWidth, metrics.padding],
  );

  return (
    <FlatList
      data={items}
      numColumns={2}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      keyExtractor={(i) => String(i.id)}
      ListHeaderComponent={header ?? undefined}
      columnWrapperStyle={{ flexDirection: rowDirection, gap: metrics.gap }}
      contentContainerStyle={styles.listContent}
      ListEmptyComponent={
        empty ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{empty}</Text>
          </View>
        ) : undefined
      }
      renderItem={({ item }) => (
        <AuctionCard
          item={item}
          width={metrics.cardWidth}
          now={now}
          onPress={() => router.push(`/item/${item.id}` as never)}
        />
      )}
    />
  );
}

function makeStyles(theme: NxsTheme, containerWidth: number, padding: number) {
  return StyleSheet.create({
    listContent: {
      width: "100%",
      maxWidth: containerWidth,
      alignSelf: "center",
      flexGrow: 1,
      paddingTop: 8,
      paddingBottom: 16,
      paddingHorizontal: padding,
    },
    empty: { padding: 28, alignItems: "center", justifyContent: "center" },
    emptyText: { fontSize: 14, lineHeight: 20, color: theme.text.secondary, textAlign: "center" },
  });
}
