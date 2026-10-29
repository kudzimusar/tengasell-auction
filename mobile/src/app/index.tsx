import { Link } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { NxsButton } from "../nxs/components/NxsButton";
import { useNxs } from "../nxs/context/NxsProvider";
import { localizeKnownRuntimeMessage } from "../nxs/localization/runtimeMessages";
import {
  type NxsTranslator,
} from "../nxs/localization/catalog";
import { useNxsText } from "../nxs/localization/useNxsText";
import type { NxsTheme } from "../nxs/tokens";

const BRAND = "TengaSell";
const BRAND_PREFIX = "Tenga";
const BRAND_SUFFIX = "Sell";

type AuthorityState = "checking" | "live" | "unavailable";

function errorMessage(error: unknown, t: NxsTranslator): string {
  return error instanceof Error
    ? localizeKnownRuntimeMessage(error.message, t, "common.genericUnavailable")
    : t("common.genericUnavailable");
}

export default function HomeScreen() {
  const session = useSession();
  const { theme, screenPadding, windowClass, writingDirection } = useNxs();
  const t = useNxsText();
  const styles = useMemo(
    () => createStyles(theme, screenPadding, windowClass, writingDirection),
    [screenPadding, theme, windowClass, writingDirection],
  );
  const [authorityState, setAuthorityState] = useState<AuthorityState>("checking");
  const [categories, setCategories] = useState<Category[]>([]);
  const [auctions, setAuctions] = useState<AuctionView[]>([]);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const initialTick = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(initialTick);
      clearInterval(timer);
    };
  }, []);

  const boot = useCallback(async () => {
    try {
      await probeCanonical();
      const [nextCategories, nextAuctions] = await Promise.all([
        fetchCategories(),
        fetchAuctions({ limit: 20 }),
      ]);
      setCategories(nextCategories);
      setAuctions(nextAuctions.map(toAuctionView));
      setAuthorityState("live");
      setError(null);
    } catch (bootError) {
      setCategories([]);
      setAuctions([]);
      setAuthorityState("unavailable");
      setError(errorMessage(bootError, t));
    }
  }, [t]);

  useEffect(() => {
    const task = setTimeout(() => {
      void boot();
    }, 0);
    return () => clearTimeout(task);
  }, [boot]);

  const retryCanonical = useCallback(() => {
    setAuthorityState("checking");
    setError(null);
    void boot();
  }, [boot]);

  const loadCategory = useCallback(
    async (slug?: string) => {
      setCategory(slug);
      setListLoading(true);
      setError(null);
      try {
        const nextAuctions = await fetchAuctions({ category: slug, limit: 40 });
        setAuctions(nextAuctions.map(toAuctionView));
        setAuthorityState("live");
      } catch (loadError) {
        setError(errorMessage(loadError, t));
      } finally {
        setListLoading(false);
      }
    },
    [t],
  );

  const emptyAction = category ? (
    <NxsButton
      label={t("home.showFeaturedAuctions")}
      variant="secondary"
      onPress={() => void loadCategory(undefined)}
    />
  ) : (
    <NxsButton
      label={t("home.refreshAuctions")}
      variant="secondary"
      onPress={retryCanonical}
    />
  );

  const sessionInvalidMessage = localizeKnownRuntimeMessage(
    session.message,
    t,
    "home.sessionInvalidFallback",
  );
  const sessionRecoveryMessage = localizeKnownRuntimeMessage(
    session.message,
    t,
    "home.sessionRecoveryUnavailable",
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.wordmark} accessibilityRole="header">
          {BRAND_PREFIX}
          <Text style={styles.brandAccent}>{BRAND_SUFFIX}</Text>
        </Text>
        {session.phase === "authenticated" ? (
          <Link href="/account" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("home.openAccount")}
              hitSlop={4}
              style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
            >
              <Text style={styles.headerButtonText}>{t("nav.account")}</Text>
            </Pressable>
          </Link>
        ) : (
          <Link href="/auth/login" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("home.signInA11y", { brand: BRAND })}
              hitSlop={4}
              style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
            >
              <Text style={styles.headerButtonText}>{t("nav.signIn")}</Text>
            </Pressable>
          </Link>
        )}
      </View>

      <View
        style={styles.authorityRow}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={
          authorityState === "checking"
            ? t("home.authorityCheckingA11y")
            : authorityState === "live"
              ? t("home.authorityConnectedA11y")
              : t("home.authorityUnavailableA11y")
        }
      >
        <Text style={styles.authorityText}>
          {authorityState === "checking"
            ? t("home.authorityChecking")
            : authorityState === "live"
              ? t("home.authorityConnected")
              : t("home.authorityUnavailable")}
        </Text>
      </View>

      {(session.phase === "signout-pending" ||
        session.phase === "signout-incomplete" ||
        session.phase === "signed-out-locally") && (
        <View style={styles.warningBox} accessibilityRole="alert">
          <Text style={styles.warningText}>
            {session.phase === "signout-pending"
              ? t("session.signoutPending")
              : session.phase === "signout-incomplete"
                ? t("session.signoutIncomplete")
                : t("session.signoutLocalOnly")}
          </Text>
          {session.phase === "signout-incomplete" && (
            <NxsButton
              label={t("session.retrySignout")}
              variant="destructive"
              onPress={() => void session.retryLogout()}
            />
          )}
        </View>
      )}

      {session.phase === "session-invalid" && (
        <View style={styles.warningBox} accessibilityRole="alert">
          <Text style={styles.warningText}>⚠ {sessionInvalidMessage}</Text>
        </View>
      )}

      {session.phase === "network-degraded" && (
        <View style={styles.warningBox} accessibilityRole="alert">
          <Text style={styles.warningText}>⚠ {sessionRecoveryMessage}</Text>
          <NxsButton
            label={t("home.retrySession")}
            variant="secondary"
            onPress={() => void session.retrySessionRecovery()}
          />
        </View>
      )}

      {error && authorityState === "live" && (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>
            {t("common.errorWithMessage", { message: error })}
          </Text>
          <NxsButton
            label={t("home.retryAuctionRequest")}
            variant="secondary"
            onPress={() => void loadCategory(category)}
          />
        </View>
      )}

      {authorityState === "checking" ? (
        <View style={styles.center} accessible accessibilityLiveRegion="polite">
          <ActivityIndicator
            color={theme.state.loading}
            size="large"
            accessibilityLabel={t("home.loadingAuctionsA11y")}
          />
          <Text style={styles.secondaryText}>{t("home.loadingAuctions")}</Text>
        </View>
      ) : authorityState === "unavailable" ? (
        <View style={styles.center}>
          <Text style={styles.title} accessibilityRole="header">
            {t("home.liveUnavailableTitle")}
          </Text>
          <Text style={styles.secondaryText}>
            {error ?? t("common.canonicalUnreachable")}
          </Text>
          <Text style={styles.secondaryText}>
            {t("home.noDemoFallback", { brand: BRAND })}
          </Text>
          <NxsButton label={t("home.retryCanonical")} onPress={retryCanonical} />
        </View>
      ) : (
        <>
          <View style={styles.chipsWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsContent}
            >
              <Pressable
                onPress={() => void loadCategory(undefined)}
                accessibilityRole="button"
                accessibilityState={{ selected: !category }}
                accessibilityLabel={t("home.showFeaturedAuctions")}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.chip,
                  !category && styles.chipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, !category && styles.chipTextActive]}>
                  {t("home.featured")}
                </Text>
              </Pressable>
              {categories.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => void loadCategory(item.slug)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: category === item.slug }}
                  accessibilityLabel={t("home.showCategoryAuctions", {
                    category: item.name,
                  })}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.chip,
                    category === item.slug && styles.chipActive,
                    pressed && styles.pressed,
                  ]}
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
              <ActivityIndicator color={theme.state.loading} />
              <Text style={styles.secondaryText}>{t("home.refreshingAuctions")}</Text>
            </View>
          )}

          <FlatList
            data={auctions}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.title} accessibilityRole="header">
                  {t("home.noLiveAuctions")}
                </Text>
                <Text style={styles.secondaryText}>
                  {t("home.tryAnotherCategory")}
                </Text>
                {emptyAction}
              </View>
            }
            renderItem={({ item }) => {
              const remainingMs = now === null ? null : Date.parse(item.ends_at) - now;
              const remaining =
                remainingMs === null
                  ? t("home.updatingTime")
                  : formatRemaining(remainingMs);
              const severity =
                remainingMs === null ? "normal" : remainingSeverity(remainingMs);
              const price = formatUSD(item.current_price);

              return (
                <View
                  style={styles.card}
                  accessible
                  accessibilityLabel={t("home.auctionA11y", {
                    title: item.title,
                    price,
                    bidCount: item.bid_count,
                    remaining,
                  })}
                >
                  {item.imageList[0] ? (
                    <Image
                      source={{ uri: item.imageList[0] }}
                      style={styles.cardImg}
                      resizeMode="cover"
                      accessible={false}
                    />
                  ) : (
                    <View style={[styles.cardImg, styles.cardImgFallback]} />
                  )}
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.cardMeta}>
                      {t("home.auctionMeta", {
                        price,
                        bidCount: item.bid_count,
                        seller: item.seller_username,
                      })}
                    </Text>
                    <Text
                      style={[
                        styles.cardTimer,
                        severity === "urgent" && styles.urgentTimer,
                      ]}
                    >
                      {item.endingSoon
                        ? t("home.endingSoon", { remaining })
                        : t("home.timeRemaining", { remaining })}
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

function createStyles(
  theme: NxsTheme,
  screenPadding: number,
  windowClass: "compact" | "regular" | "wide",
  writingDirection: "ltr" | "rtl",
) {
  const imageSize = windowClass === "compact" ? 104 : 120;
  const textAlign = writingDirection === "rtl" ? "right" : "left";
  const rowDirection = writingDirection === "rtl" ? "row-reverse" : "row";

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.surface.canvas },
    header: {
      minHeight: 64,
      flexDirection: rowDirection,
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: screenPadding,
      paddingVertical: 8,
      backgroundColor: theme.surface.section,
    },
    wordmark: {
      fontSize: 22,
      lineHeight: 29,
      fontWeight: "800",
      color: theme.action.primary,
      letterSpacing: -0.5,
      textAlign,
    },
    brandAccent: { color: theme.brand.accent },
    headerButton: {
      minHeight: 48,
      minWidth: 48,
      justifyContent: "center",
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.action.secondary,
    },
    headerButtonText: {
      color: theme.action.secondary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
      textAlign: "center",
    },
    pressed: { opacity: 0.78 },
    authorityRow: {
      minHeight: 48,
      justifyContent: "center",
      paddingHorizontal: screenPadding,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.subtle,
      backgroundColor: theme.surface.section,
    },
    authorityText: {
      color: theme.text.secondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      textAlign,
    },
    warningBox: {
      marginHorizontal: screenPadding,
      marginTop: 12,
      padding: 12,
      gap: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border.warning,
      backgroundColor: theme.surface.raised,
    },
    warningText: {
      color: theme.state.warning,
      fontSize: 14,
      lineHeight: 21,
      textAlign,
    },
    errorBox: {
      marginHorizontal: screenPadding,
      marginTop: 12,
      padding: 12,
      gap: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border.error,
      backgroundColor: theme.surface.raised,
    },
    errorText: {
      color: theme.state.error,
      fontSize: 14,
      lineHeight: 21,
      textAlign,
    },
    center: {
      flex: 1,
      width: "100%",
      maxWidth: 720,
      alignSelf: "center",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: Math.max(screenPadding, 24),
    },
    title: {
      color: theme.text.primary,
      fontSize: 22,
      lineHeight: 29,
      fontWeight: "800",
      textAlign: "center",
    },
    secondaryText: {
      color: theme.text.secondary,
      fontSize: 16,
      lineHeight: 24,
      textAlign: "center",
    },
    chipsWrap: {
      backgroundColor: theme.surface.section,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.subtle,
    },
    chipsContent: {
      flexDirection: rowDirection,
      gap: 8,
      paddingHorizontal: screenPadding,
      paddingVertical: 8,
    },
    chip: {
      minHeight: 48,
      minWidth: 48,
      justifyContent: "center",
      paddingHorizontal: 14,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border.subtle,
      backgroundColor: theme.surface.raised,
    },
    chipActive: {
      backgroundColor: theme.action.primary,
      borderColor: theme.action.primary,
    },
    chipText: {
      color: theme.text.secondary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
      textAlign: "center",
    },
    chipTextActive: { color: theme.text.inverse },
    listLoading: {
      minHeight: 48,
      flexDirection: rowDirection,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingHorizontal: screenPadding,
    },
    list: {
      width: "100%",
      maxWidth: 920,
      alignSelf: "center",
      flexGrow: 1,
      padding: screenPadding,
      gap: 12,
    },
    emptyState: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingVertical: 32,
    },
    card: {
      flexDirection: rowDirection,
      backgroundColor: theme.surface.raised,
      borderRadius: 14,
      overflow: "hidden",
    },
    cardImg: { width: imageSize, height: imageSize },
    cardImgFallback: { backgroundColor: theme.brand.deep },
    cardBody: { flex: 1, padding: 12, justifyContent: "center", gap: 4 },
    cardTitle: {
      color: theme.text.primary,
      fontSize: 16,
      lineHeight: 24,
      fontWeight: "700",
      textAlign,
    },
    cardMeta: {
      color: theme.text.secondary,
      fontSize: 13,
      lineHeight: 18,
      textAlign,
    },
    cardTimer: {
      color: theme.state.warning,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      textAlign,
    },
    urgentTimer: { color: theme.state.error, fontWeight: "800" },
  });
}
