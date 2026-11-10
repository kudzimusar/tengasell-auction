// Shared two-column listing grid (Temu-style density).

import { useRouter } from "expo-router";
import { useWindowDimensions } from "react-native";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { AuctionCard } from "./AuctionCard";
import type { AuctionView } from "../lib/types";

interface Props {
  items: AuctionView[];
  now: number;
  empty?: string;
  header?: React.ReactElement | null;
  contentPadding?: number;
}

export function ListingGrid({ items, now, empty, header, contentPadding = 10 }: Props) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const cardWidth = Math.floor((width - contentPadding * 2 - 10) / 2);

  return (
    <FlatList
      data={items}
      numColumns={2}
      keyExtractor={(i) => String(i.id)}
      ListHeaderComponent={header ?? undefined}
      columnWrapperStyle={{ gap: 10, paddingHorizontal: contentPadding }}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}
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
          width={cardWidth}
          now={now}
          onPress={() => router.push(`/item/${item.id}` as never)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  empty: { padding: 28, alignItems: "center" },
  emptyText: { fontSize: 13, color: "#5C6B72", textAlign: "center" },
});
