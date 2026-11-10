// Categories tab — grid of marketplace categories, tap to browse.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../components/BottomNav";
import { ListingGrid } from "../components/ListingGrid";
import { fetchAuctions, fetchCategories } from "../lib/trailbase";
import { toAuctionView, type AuctionView, type Category } from "../lib/types";

export default function CategoriesScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<Category | null>(null);
  const [items, setItems] = useState<AuctionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCategories(await fetchCategories());
    } catch {
      setError("Could not load categories. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred one tick: the fetch itself sets loading synchronously, which
    // would otherwise cascade a render during the effect.
    const task = setTimeout(() => {
      void loadCategories();
    }, 0);
    return () => clearTimeout(task);
  }, [loadCategories]);

  const open = useCallback(async (c: Category) => {
    setSelected(c);
    setLoading(true);
    try {
      const rows = await fetchAuctions({ category: c.slug, limit: 40 });
      setItems(rows.map(toAuctionView));
      setError(null);
    } catch {
      setError("Could not load this category.");
    } finally {
      setLoading(false);
    }
  }, []);

  const styles = useMemo(() => makeStyles(), []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{selected ? selected.name : "Categories"}</Text>
        {selected && (
          <Pressable hitSlop={4} onPress={() => setSelected(null)} accessibilityRole="button">
            <Text style={styles.back}>All</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#19717B" />
        </View>
      ) : error && !selected ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>{error}</Text>
          <Pressable hitSlop={4} onPress={() => void loadCategories()} accessibilityRole="button">
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : selected ? (
        <ListingGrid items={items} now={now} empty={error ?? "No listings in this category yet."} />
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {categories.map((c) => (
            <Pressable hitSlop={4}
              key={c.id}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
              onPress={() => void open(c)}
              accessibilityRole="button"
              accessibilityLabel={c.name}
            >
              <View style={styles.tileIcon}>
                <Text style={styles.tileLetter}>{c.name.slice(0, 1)}</Text>
              </View>
              <Text style={styles.tileLabel} numberOfLines={2}>
                {c.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <BottomNav />
    </SafeAreaView>
  );
}

function makeStyles() {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: "#F6F9FA" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: "#FFFFFF",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "#DCE4E8",
    },
    title: { fontSize: 17, fontWeight: "800", color: "#101619" },
    back: { fontSize: 13, fontWeight: "700", color: "#19717B" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
    errorTitle: { fontSize: 14, color: "#5C6B72", textAlign: "center" },
    retry: { fontSize: 14, fontWeight: "800", color: "#19717B" },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      padding: 10,
      gap: 10,
    },
    tile: {
      width: "31.5%",
      backgroundColor: "#FFFFFF",
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "#E2E8EC",
      paddingVertical: 14,
      alignItems: "center",
      gap: 8,
    },
    tileIcon: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: "rgba(25,113,123,0.10)",
      alignItems: "center",
      justifyContent: "center",
    },
    tileLetter: { fontSize: 20, fontWeight: "900", color: "#19717B" },
    tileLabel: { fontSize: 11.5, textAlign: "center", color: "#33424A", paddingHorizontal: 6 },
  });
}
