import { Link } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../auth/session-context";
import { formatRemaining, formatUSD, remainingSeverity } from "../lib/format";
import { fetchAuctions, fetchCategories, probeCanonical } from "../lib/trailbase";
import { toAuctionView, type AuctionView, type Category } from "../lib/types";

const TEAL = "#19717B";
const TEAL_DEEP = "#0F5A62";
const GOLD = "#DFAE2E";
const OCHRE = "#7A5B13";
const INK = "#0A0D10";
const MUTED = "#5C6B72";
const LINE = "#DDE5E9";
const DANGER = "#8F2D2D";
const MIN_TOUCH = 44;

type AuthorityState = "checking" | "live" | "unavailable";

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Canonical auction authority is unavailable.";
}

export default function HomeScreen() {
  const session = useSession();
  const [authorityState, setAuthorityState] = useState<AuthorityState>("checking");
  const [categories, setCategories] = useState<Category[]>([]);
  const [auctions, setAuctions] = useState<AuctionView[]>([]);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const boot = useCallback(async () => {
    setAuthorityState("checking");
    setError(null);
    try {
      await probeCanonical();
      const [nextCategories, nextAuctions] = await Promise.all([
        fetchCategories(),
        fetchAuctions({ limit: 20 }),
      ]);
      setCategories(nextCategories);
      setAuctions(nextAuctions.map(toAuctionView));
      setAuthorityState("live");
    } catch (bootError) {
      setCategories([]);
      setAuctions([]);
      setAuthorityState("unavailable");
      setError(errorMessage(bootError));
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  const loadCategory = useCallback(async (slug?: string) => {
    setCategory(slug);
    setListLoading(true);
    setError(null);
    try {
      const nextAuctions = await fetchAuctions({ category: slug, limit: 40 });
      setAuctions(nextAuctions.map(toAuctionView));
      setAuthorityState("live");
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setListLoading(false);
    }
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.wordmark} accessibilityRole="header">
          Tenga<Text style={styles.gold}>Sell</Text>
        </Text>
        <View style={styles.headerActions}>
          {session.phase === "authenticated" ? (
            <Link href="/account" asChild>
              <Pressable
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel="Open account"
              >
                <Text style={styles.headerButtonText}>Account</Text>
              </Pressable>
            </Link>
          ) : (
            <Link href="/auth/login" asChild>
              <Pressable
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel="Sign in to TengaSell"
              >
                <Text style={styles.headerButtonText}>Sign in</Text>
              </Pressable>
            </Link>
          )}
        </View>
      </View>

      <View
        style={styles.authorityRow}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={
          authorityState === "checking"
            ? "Checking canonical auction authority"
            : authorityState === "live"
              ? "Canonical auction authority connected"
              : "Canonical auction authority unavailable"
        }
      >
        <View
          style={[
            styles.dot,
            authorityState === "live" ? styles.dotLive : styles.dotAttention,
          ]}
        />
        <Text style={styles.authorityText}>
          {authorityState === "checking"
            ? "Checking canonical authority"
            : authorityState === "live"
              ? "Canonical authority connected"
              : "Canonical authority unavailable"}
        </Text>
      </View>

      {session.phase === "session-invalid" && (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>
            {session.message ?? "Your saved session is no longer valid. Sign in again."}
          </Text>
        </View>
      )}

      {session.phase === "network-degraded" && (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>
            {session.message ??
              "Session recovery is unavailable while the authority cannot be reached."}
          </Text>
          <Pressable
            style={styles.inlineButton}
            onPress={() => void session.retrySessionRecovery()}
            accessibilityRole="button"
            accessibilityLabel="Retry session recovery"
          >
            <Text style={styles.inlineButtonText}>Retry session</Text>
          </Pressable>
        </View>
      )}

      {error && (
        <View style={styles.errorBar} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => void boot()}
            accessibilityRole="button"
            accessibilityLabel="Retry canonical authority connection"
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {authorityState === "checking" ? (
        <View style={styles.center} accessible accessibilityLiveRegion="polite">
          <ActivityIndicator color={TEAL} size="large" accessibilityLabel="Loading auctions" />
          <Text style={styles.mutedText}>Loading live auction data…</Text>
        </View>
      ) : authorityState === "unavailable" ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Live auctions are temporarily unavailable.</Text>
          <Text style={styles.mutedText}>
            TengaSell has not substituted demo or cached commercial authority.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.chipsWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Pressable
                style={[styles.chip, !category && styles.chipActive]}
                onPress={() => void loadCategory(undefined)}
                accessibilityRole="button"
                accessibilityState={{ selected: !category }}
                accessibilityLabel="Show featured auctions"
              >
                <Text style={[styles.chipText, !category && styles.chipTextActive]}>
                  Featured
                </Text>
              </Pressable>
              {categories.map((item) => (
                <Pressable
                  key={item.id}
                  style={[styles.chip, category === item.slug && styles.chipActive]}
                  onPress={() => void loadCategory(item.slug)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: category === item.slug }}
                  accessibilityLabel={`Show ${item.name} auctions`}
                >
                  <Text
                    style={[
                      styles.chipText,
                      category === item.slug && styles.chipTextActive,
                    ]}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {listLoading && (
            <View style={styles.listLoading} accessible accessibilityLiveRegion="polite">
              <ActivityIndicator color={TEAL} />
              <Text style={styles.mutedText}>Updating auctions…</Text>
            </View>
          )}

          <FlatList
            data={auctions}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.mutedText}>No live auctions in this category.</Text>
            }
            renderItem={({ item }) => {
              const remainingMs = Date.parse(item.ends_at) - now;
              const remaining = formatRemaining(remainingMs);
              const severity = remainingSeverity(remainingMs);
              return (
                <View
                  style={styles.card}
                  accessible
                  accessibilityLabel={`${item.title}. ${formatUSD(item.current_price)}. ${item.bid_count} bids. ${remaining} remaining.`}
                >
                  {item.imageList[0] ? (
                    <Image
                      source={{ uri: item.imageList[0] }}
                      style={styles.cardImg}
                      accessibilityLabel={`${item.title} auction image`}
                    />
                  ) : (
                    <View style={[styles.cardImg, styles.cardImgFallback]} />
                  )}
                  <View style={styles.cardBody}>
                    <Text numberOfLines={2} style={styles.cardTitle}>
                      {item.title}
                    </Text>
                    <Text style={styles.cardMeta}>
                      {formatUSD(item.current_price)} · {item.bid_count} bids · @
                      {item.seller_username}
                    </Text>
                    <Text
                      style={[
                        styles.cardTimer,
                        severity === "urgent" && styles.urgentTimer,
                      ]}
                    >
                      {item.endingSoon ? "Ending soon · " : "Time remaining · "}
                      {remaining}
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
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    backgroundColor: "#FFFFFF",
  },
  wordmark: { fontSize: 22, fontWeight: "800", color: TEAL, letterSpacing: -0.5 },
  gold: { color: GOLD },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerButton: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TEAL,
  },
  headerButtonText: { color: TEAL, fontWeight: "700" },
  authorityRow: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    backgroundColor: "#FFFFFF",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotLive: { backgroundColor: TEAL },
  dotAttention: { backgroundColor: GOLD },
  authorityText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  notice: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#C6A652",
    backgroundColor: "#FFF9E8",
    gap: 8,
  },
  noticeText: { color: "#5F4A17", fontSize: 13 },
  inlineButton: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: OCHRE,
  },
  inlineButtonText: { color: OCHRE, fontWeight: "700" },
  errorBar: {
    margin: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#FFF1F1",
    borderWidth: 1,
    borderColor: "#E1A9A9",
    gap: 8,
  },
  errorText: { color: DANGER, fontSize: 13 },
  retryButton: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: DANGER,
  },
  retryButtonText: { color: "#FFFFFF", fontWeight: "700" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    padding: 24,
  },
  emptyTitle: { color: INK, fontSize: 17, fontWeight: "700", textAlign: "center" },
  mutedText: { color: MUTED, fontSize: 13, padding: 12, textAlign: "center" },
  chipsWrap: {
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    backgroundColor: "#FFFFFF",
    paddingVertical: 6,
  },
  chip: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    marginLeft: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: "#FFFFFF",
  },
  chipActive: { backgroundColor: TEAL, borderColor: TEAL },
  chipText: { fontSize: 13, fontWeight: "600", color: MUTED },
  chipTextActive: { color: "#FFFFFF" },
  listLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  list: { padding: 12, gap: 12, flexGrow: 1 },
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
  urgentTimer: { color: DANGER, fontWeight: "800" },
});
