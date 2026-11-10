// Search tab — title search against the canonical records API.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../components/BottomNav";
import { ListingGrid } from "../components/ListingGrid";
import { fetchAuctions, fetchCategories } from "../lib/trailbase";
import { toAuctionView, type AuctionView, type Category } from "../lib/types";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AuctionView[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => undefined);
  }, []);

  const run = useCallback(async (q: string) => {
    const term = q.trim();
    if (!term) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await fetchAuctions({ search: term, limit: 40 });
      setItems(rows.map(toAuctionView));
      setSearched(true);
    } catch {
      setError("Search is unavailable right now.");
    } finally {
      setBusy(false);
    }
  }, []);

  const styles = useMemo(() => makeStyles(), []);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.searchBar}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search auctions — iPhone, solar, Hilux…"
          placeholderTextColor="#8A979E"
          returnKeyType="search"
          onSubmitEditing={() => void run(query)}
          style={styles.input}
          accessibilityLabel="Search auctions"
        />
        <Pressable hitSlop={4} style={styles.go} onPress={() => void run(query)} accessibilityRole="button" accessibilityLabel="Search">
          <Text style={styles.goText}>Search</Text>
        </Pressable>
      </View>

      {!searched && (
        <View style={styles.suggestWrap}>
          <Text style={styles.suggestTitle}>Browse by category</Text>
          <View style={styles.chips}>
            {categories.slice(0, 8).map((c) => (
              <Pressable hitSlop={4} key={c.id} style={styles.chip} onPress={() => { setQuery(c.name); void run(c.name); }}>
                <Text style={styles.chipText}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {busy ? (
        <View style={styles.center}>
          <ActivityIndicator color="#19717B" />
        </View>
      ) : (
        <ListingGrid
          items={items}
          now={now}
          empty={searched ? (error ?? "No auctions match that search.") : "Search live and sold auctions."}
        />
      )}
      <BottomNav />
    </SafeAreaView>
  );
}

function makeStyles() {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: "#F6F9FA" },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: "#FFFFFF",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "#DCE4E8",
    },
    input: {
      flex: 1,
      height: 48,
      borderRadius: 24,
      borderWidth: 1.5,
      borderColor: "#19717B",
      paddingHorizontal: 14,
      fontSize: 13.5,
      color: "#101619",
      backgroundColor: "#FFFFFF",
    },
    go: { backgroundColor: "#19717B", paddingHorizontal: 16, height: 48, minHeight: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
    goText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
    suggestWrap: { padding: 14, gap: 10 },
    suggestTitle: { fontSize: 12.5, fontWeight: "800", color: "#101619" },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { borderWidth: 1, borderColor: "#DCE4E8", backgroundColor: "#FFFFFF", borderRadius: 999, paddingHorizontal: 14, minHeight: 48, justifyContent: "center" },
    chipText: { fontSize: 12, color: "#33424A", fontWeight: "600" },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
  });
}
