// TENGASELL-MOBILE-01 — foundation vertical slice.
//
// Proves the canonical-authority contract on native:
//   1. probe TrailBase through the gateway (same ?XTransformPort convention
//      as the web remote adapter) and surface Live vs Demo truthfully;
//   2. render real categories and live auctions from the records API;
//   3. reuse the ported, unchanged domain types/format helpers.
//
// STATUS: READY_FOR_VERIFICATION — implementation claim only; not self-certified.

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { formatRemaining, formatUSD, remainingSeverity } from "./src/lib/format";
import { fetchAuctions, fetchCategories, probeCanonical } from "./src/lib/trailbase";
import { toAuctionView, type AuctionView, type Category } from "./src/lib/types";

const TEAL = "#19717B";
const TEAL_DEEP = "#0F5A62";
const GOLD = "#DFAE2E";
const OCHRE = "#9A7420";
const INK = "#0A0D10";
const MUTED = "#5C6B72";
const LINE = "#DDE5E9";

export default function App() {
  const [probed, setProbed] = useState(false);
  const [live, setLive] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [auctions, setAuctions] = useState<AuctionView[]>([]);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const boot = useCallback(async () => {
    setError(null);
    const ok = await probeCanonical();
    setLive(ok);
    setProbed(true);
    if (ok) {
      try {
        const [cats, aucs] = await Promise.all([
          fetchCategories(),
          fetchAuctions({ limit: 20 }),
        ]);
        setCategories(cats);
        setAuctions(aucs.map(toAuctionView));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  const loadCategory = useCallback(async (slug?: string) => {
    setCategory(slug);
    try {
      const aucs = await fetchAuctions({ category: slug, limit: 40 });
      setAuctions(aucs.map(toAuctionView));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.wordmark}>
          Tenga<Text style={{ color: GOLD }}>Sell</Text>
        </Text>
        <View
          style={[
            styles.pill,
            live
              ? { backgroundColor: "rgba(25,113,123,0.12)", borderColor: "rgba(25,113,123,0.4)" }
              : { backgroundColor: "rgba(223,174,46,0.14)", borderColor: "rgba(223,174,46,0.5)" },
          ]}
        >
          <View style={[styles.dot, { backgroundColor: live ? TEAL : GOLD }]} />
          <Text style={[styles.pillText, { color: live ? TEAL : OCHRE }]}>
            {!probed ? "Checking" : live ? "Live engine" : "Demo mode"}
          </Text>
        </View>
      </View>

      {error && (
        <Pressable style={styles.errorBar} onPress={boot}>
          <Text style={styles.errorText}>{error} — tap to retry</Text>
        </Pressable>
      )}

      {!probed ? (
        <View style={styles.center}>
          <ActivityIndicator color={TEAL} size="large" />
          <Text style={styles.mutedText}>Probing the auction authority…</Text>
        </View>
      ) : (
        <>
          <View style={styles.chipsWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Pressable
                style={[styles.chip, !category && styles.chipActive]}
                onPress={() => loadCategory(undefined)}
              >
                <Text style={[styles.chipText, !category && styles.chipTextActive]}>Featured</Text>
              </Pressable>
              {categories.map((c) => (
                <Pressable
                  key={c.id}
                  style={[styles.chip, category === c.slug && styles.chipActive]}
                  onPress={() => loadCategory(c.slug)}
                >
                  <Text style={[styles.chipText, category === c.slug && styles.chipTextActive]}>
                    {c.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <FlatList
            data={auctions}
            keyExtractor={(a) => String(a.id)}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.mutedText}>No live auctions in this category.</Text>
            }
            renderItem={({ item }) => {
              const rem = formatRemaining(Date.parse(item.ends_at) - now);
              const sev = remainingSeverity(Date.parse(item.ends_at) - now);
              return (
                <View style={styles.card}>
                  {item.imageList[0] ? (
                    <Image source={{ uri: item.imageList[0] }} style={styles.cardImg} />
                  ) : (
                    <View style={[styles.cardImg, styles.cardImgFallback]} />
                  )}
                  <View style={styles.cardBody}>
                    <Text numberOfLines={2} style={styles.cardTitle}>
                      {item.title}
                    </Text>
                    <Text style={styles.cardMeta}>
                      {formatUSD(item.current_price)} · {item.bid_count} bids · @{item.seller_username}
                    </Text>
                    <Text
                      style={[
                        styles.cardTimer,
                        sev === "urgent" && { color: "#B33A3A", fontWeight: "700" },
                      ]}
                    >
                      {item.endingSoon ? "Ending soon · " : ""}
                      {rem}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F9FA" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    backgroundColor: "#FFFFFF",
  },
  wordmark: { fontSize: 22, fontWeight: "800", color: TEAL, letterSpacing: -0.5 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 11, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorBar: {
    margin: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "rgba(179,58,58,0.08)",
    borderWidth: 1,
    borderColor: "rgba(179,58,58,0.3)",
  },
  errorText: { color: "#8F2D2D", fontSize: 13, textAlign: "center" },
  mutedText: { color: MUTED, fontSize: 13, padding: 16, textAlign: "center" },
  chipsWrap: {
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    backgroundColor: "#FFFFFF",
    paddingVertical: 8,
  },
  chip: {
    marginLeft: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: "#FFFFFF",
  },
  chipActive: { backgroundColor: TEAL, borderColor: TEAL },
  chipText: { fontSize: 13, fontWeight: "600", color: MUTED },
  chipTextActive: { color: "#FFFFFF" },
  list: { padding: 12, gap: 12 },
  card: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: LINE,
    overflow: "hidden",
  },
  cardImg: { width: 104, height: 104 },
  cardImgFallback: { backgroundColor: TEAL_DEEP },
  cardBody: { flex: 1, padding: 12, justifyContent: "center", gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: INK },
  cardMeta: { fontSize: 13, color: MUTED },
  cardTimer: { fontSize: 12, color: OCHRE, fontWeight: "600" },
});
