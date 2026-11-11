import { Link, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../auth/session-context";
import { AuctionCard } from "../components/AuctionCard";
import { BottomNav } from "../components/BottomNav";
import { computeGridMetrics } from "../lib/grid-layout";
import { createRequestGuard } from "../lib/request-guard";
import { fetchAuctions, fetchCategories, probeCanonical } from "../lib/trailbase";
import { toAuctionView, type AuctionView, type Category } from "../lib/types";
import { NxsButton } from "../nxs/components/NxsButton";
import { useNxs } from "../nxs/context/NxsProvider";
import { type NxsTranslator } from "../nxs/localization/catalog";
import { localizeKnownRuntimeMessage } from "../nxs/localization/runtimeMessages";
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
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { theme, screenPadding, safeArea, writingDirection } = useNxs();
  const t = useNxsText();
  const grid = useMemo(
    () =>
      computeGridMetrics({
        viewportWidth: width,
        columns: 2,
        padding: screenPadding,
        safeLeft: safeArea.left,
        safeRight: safeArea.right,
      }),
    [safeArea.left, safeArea.right, screenPadding, width],
  );
  const styles = useMemo(
    () => createStyles(theme, screenPadding, writingDirection, grid.containerWidth, grid.gap),
    [grid.containerWidth, grid.gap, screenPadding, theme, writingDirection],
  );
  const listRequestGuard = useRef(createRequestGuard()).current;
  const [authorityState, setAuthorityState] = useState<AuthorityState>("checking");
  const [categories, setCategories] = useState<Category[]>([]);
  const [auctions, setAuctions] = useState<AuctionView[]>([]);
  const [sold, setSold] = useState<AuctionView[]>([]);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const initialTick = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(initialTick);
      clearInterval(timer);
    };
  }, []);

  const boot = useCallback(async () => {
    const request = listRequestGuard.next();
    try {
      await probeCanonical();
      const [nextCategories, nextAuctions, nextSold] = await Promise.all([
        fetchCategories(),
        fetchAuctions({ limit: 20 }),
        fetchAuctions({ status: "sold", limit: 6 }).catch(() => []),
      ]);
      if (!listRequestGuard.isCurrent(request)) return;
      setCategories(nextCategories);
      setAuctions(nextAuctions.map(toAuctionView));
      setSold(nextSold.map(toAuctionView));
      setAuthorityState("live");
      setError(null);
    } catch (bootError) {
      if (!listRequestGuard.isCurrent(request)) return;
      setCategories([]);
      setAuctions([]);
      setAuthorityState("unavailable");
      setError(errorMessage(bootError, t));
    }
  }, [listRequestGuard, t]);

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
      const request = listRequestGuard.next();
      setCategory(slug);
      setListLoading(true);
      setError(null);
      try {
        const nextAuctions = await fetchAuctions({ category: slug, limit: 40 });
        if (!listRequestGuard.isCurrent(request)) return;
        setAuctions(nextAuctions.map(toAuctionView));
        setAuthorityState("live");
      } catch (loadError) {
        if (!listRequestGuard.isCurrent(request)) return;
        setAuctions([]);
        setError(errorMessage(loadError, t));
      } finally {
        if (listRequestGuard.isCurrent(request)) setListLoading(false);
      }
    },
    [listRequestGuard, t],
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
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
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
            numColumns={2}
            columnWrapperStyle={styles.columnRow}
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
            renderItem={({ item }) => (
              <AuctionCard
                item={item}
                width={grid.cardWidth}
                now={now}
                onPress={() => router.push(`/item/${item.id}` as never)}
              />
            )}
            ListFooterComponent={
              sold.length > 0 ? (
                <View style={styles.soldSection}>
                  <Text style={styles.soldTitle} accessibilityRole="header">
                    {t("home.recentlySold")}
                  </Text>
                  <View style={styles.soldWrap}>
                    {sold.map((row) => (
                      <AuctionCard
                        key={`sold-${row.id}`}
                        item={row}
                        width={grid.cardWidth}
                        now={now}
                        onPress={() => router.push(`/item/${row.id}` as never)}
                      />
                    ))}
                  </View>
                </View>
              ) : undefined
            }
          />

        </>
      )}
      <BottomNav active="home" />
    </SafeAreaView>
  );
}

function createStyles(
  theme: NxsTheme,
  screenPadding: number,
  writingDirection: "ltr" | "rtl",
  containerWidth: number,
  gridGap: number,
) {
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
    columnRow: {
      flexDirection: rowDirection,
      gap: gridGap,
    },
    list: {
      width: "100%",
      maxWidth: containerWidth,
      alignSelf: "center",
      flexGrow: 1,
      paddingHorizontal: screenPadding,
      paddingVertical: 12,
    },
    emptyState: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingVertical: 32,
    },
    soldSection: {
      paddingTop: 6,
    },
    soldTitle: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "800",
      color: theme.text.primary,
      paddingBottom: 8,
      textAlign,
    },
    soldWrap: {
      flexDirection: rowDirection,
      flexWrap: "wrap",
      gap: gridGap,
    },
  });
}
