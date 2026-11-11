import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { useSession } from "../auth/session-context";
import { fetchAuthenticatedProfile } from "../lib/trailbase";
import type { Profile } from "../lib/types";
import { NxsButton } from "../nxs/components/NxsButton";
import { useNxs } from "../nxs/context/NxsProvider";
import { localizeKnownRuntimeMessage } from "../nxs/localization/runtimeMessages";
import { useNxsText } from "../nxs/localization/useNxsText";
import type { NxsTheme } from "../nxs/tokens";

const BRAND = "TengaSell";

export interface AccountContentProps {
  embeddedTab?: boolean;
  titleOverride?: string;
}

export function AccountContent({
  embeddedTab = false,
  titleOverride,
}: AccountContentProps) {
  const session = useSession();
  const { theme, screenPadding, windowClass, writingDirection } = useNxs();
  const t = useNxsText();
  const styles = useMemo(
    () => createStyles(theme, screenPadding, windowClass, writingDirection),
    [screenPadding, theme, windowClass, writingDirection],
  );
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Embedded inside the bottom-tab bar (`/you`), `BottomNav` owns the bottom
  // safe-area inset and `SafeAreaView` takes the top edge (`headerShown: false`).
  // Standalone `/account` renders under the native stack header and owns bottom inset.
  const edges: readonly Edge[] = embeddedTab
    ? ["top", "left", "right"]
    : ["left", "right", "bottom"];

  const retryProfile = useCallback(async () => {
    if (session.phase !== "authenticated" || !session.identity) return;
    const userId = session.identity.id;
    setLoading(true);
    setError(null);
    try {
      const nextProfile = await session.withAuthenticatedToken((authToken) =>
        fetchAuthenticatedProfile(authToken, userId),
      );
      setProfile(nextProfile);
    } catch (loadError) {
      setProfile(null);
      setError(
        loadError instanceof Error
          ? localizeKnownRuntimeMessage(
              loadError.message,
              t,
              "account.profileRequestFailed",
            )
          : t("account.profileRequestFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [session, t]);

  useEffect(() => {
    if (session.phase === "anonymous" || session.phase === "session-invalid") {
      if (!embeddedTab) {
        router.replace("/auth/login");
      }
      return;
    }
    if (session.phase !== "authenticated" || !session.identity) return;

    let active = true;
    const userId = session.identity.id;

    void session
      .withAuthenticatedToken((authToken) => fetchAuthenticatedProfile(authToken, userId))
      .then(
        (nextProfile) => {
          if (!active) return;
          setProfile(nextProfile);
          setError(null);
          setLoading(false);
        },
        (loadError: unknown) => {
          if (!active) return;
          setProfile(null);
          setError(
            loadError instanceof Error
              ? localizeKnownRuntimeMessage(
                  loadError.message,
                  t,
                  "account.profileRequestFailed",
                )
              : t("account.profileRequestFailed"),
          );
          setLoading(false);
        },
      );

    return () => {
      active = false;
    };
  }, [embeddedTab, session, t]);

  const signOut = async () => {
    setProfile(null);
    setError(null);
    const result = await session.logout();
    if (result.status !== "incomplete" && !embeddedTab) router.replace("/");
  };

  if (session.phase === "booting") {
    return (
      <SafeAreaView style={styles.safe} edges={edges}>
        <View style={styles.center} accessible accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.state.loading} size="large" />
          <Text style={styles.secondaryText}>{t("account.restoringSession")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (session.phase === "signout-pending" ||
      session.phase === "signout-incomplete") {
    return (
      <SafeAreaView style={styles.safe} edges={edges}>
        <View style={styles.center}>
          <Text style={styles.title} accessibilityRole="header">
            {session.phase === "signout-pending"
              ? t("session.signoutPending")
              : t("session.signoutIncompleteTitle")}
          </Text>
          {session.phase === "signout-incomplete" && (
            <>
              <Text style={styles.secondaryText} accessibilityRole="alert">
                {t("session.signoutIncomplete")}
              </Text>
              <NxsButton
                label={t("session.retrySignout")}
                variant="destructive"
                onPress={() => void signOut()}
              />
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (session.phase === "network-degraded") {
    const unavailableMessage = localizeKnownRuntimeMessage(
      session.message,
      t,
      "account.unavailableFallback",
    );

    return (
      <SafeAreaView style={styles.safe} edges={edges}>
        <View style={styles.center}>
          <Text style={styles.title} accessibilityRole="header">
            {t("account.unavailableTitle")}
          </Text>
          <Text style={styles.secondaryText} accessibilityRole="alert">
            ⚠ {unavailableMessage}
          </Text>
          <View style={styles.actionGroup}>
            <NxsButton
              label={t("account.retrySession")}
              onPress={() => void session.retrySessionRecovery()}
            />
            <NxsButton
              label={t("account.signOutDevice")}
              variant="destructive"
              onPress={() => void signOut()}
              accessibilityHint={t("account.signOutDeviceHint")}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (session.phase !== "authenticated" || !session.identity) {
    if (embeddedTab) {
      const invalidReason =
        session.phase === "session-invalid"
          ? localizeKnownRuntimeMessage(
              session.message,
              t,
              "home.sessionInvalidFallback",
            )
          : null;

      return (
        <SafeAreaView style={styles.safe} edges={edges}>
          <View style={styles.center}>
            <Text style={styles.title} accessibilityRole="header">
              {t("you.signedOutTitle", { brand: BRAND })}
            </Text>
            {invalidReason ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                ⚠ {invalidReason}
              </Text>
            ) : null}
            <Text style={styles.secondaryText}>{t("you.signedOutBody")}</Text>
            <NxsButton
              label={t("you.signInAction")}
              accessibilityLabel={t("you.signInA11y", { brand: BRAND })}
              onPress={() => router.push("/auth/login" as never)}
            />
          </View>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.safe} edges={edges}>
        <View style={styles.center} accessible accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.state.loading} />
          <Text style={styles.secondaryText}>{t("account.returningToSignIn")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.panel}>
          <Text style={styles.title} accessibilityRole="header">
            {titleOverride ?? t("account.title")}
          </Text>
          <Text style={styles.successText} accessible accessibilityLiveRegion="polite">
            {t("account.authenticatedStatus")}
          </Text>

          <View style={styles.card}>
            {loading ? (
              <View style={styles.loadingRow} accessible accessibilityLiveRegion="polite">
                <ActivityIndicator color={theme.state.loading} />
                <Text style={styles.secondaryText}>{t("account.loadingProfile")}</Text>
              </View>
            ) : error ? (
              <View style={styles.stateGroup} accessibilityRole="alert">
                <Text style={styles.errorText}>
                  {t("common.errorWithMessage", { message: error })}
                </Text>
                <NxsButton
                  label={t("account.retryProfile")}
                  variant="secondary"
                  onPress={() => void retryProfile()}
                />
              </View>
            ) : profile ? (
              <View style={styles.stateGroup}>
                <Text style={styles.profileName}>
                  {profile.display_name || profile.username || t("account.authenticatedUser")}
                </Text>
                {profile.username && (
                  <Text style={styles.secondaryText}>@{profile.username}</Text>
                )}
                <Text style={styles.identityLabel}>{t("account.userId")}</Text>
                <Text selectable style={styles.identityValue}>
                  {session.identity.id}
                </Text>
              </View>
            ) : (
              <View style={styles.stateGroup} accessibilityRole="alert">
                <Text style={styles.partialText}>{t("account.profileIncomplete")}</Text>
                <Text style={styles.secondaryText}>
                  {t("account.profileIncompleteDetail")}
                </Text>
                <Text style={styles.identityLabel}>{t("account.userId")}</Text>
                <Text selectable style={styles.identityValue}>
                  {session.identity.id}
                </Text>
                <NxsButton
                  label={t("account.retryProfile")}
                  variant="secondary"
                  onPress={() => void retryProfile()}
                />
              </View>
            )}
          </View>

          <NxsButton
            label={t("account.signOut")}
            variant="destructive"
            onPress={() => void signOut()}
            accessibilityHint={t("account.signOutHint")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(
  theme: NxsTheme,
  screenPadding: number,
  windowClass: "compact" | "regular" | "wide",
  writingDirection: "ltr" | "rtl",
) {
  const maxWidth = windowClass === "compact" ? undefined : 640;
  const textAlign = writingDirection === "rtl" ? "right" : "left";
  const rowDirection = writingDirection === "rtl" ? "row-reverse" : "row";

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.surface.canvas },
    center: {
      flex: 1,
      width: "100%",
      maxWidth: 640,
      alignSelf: "center",
      justifyContent: "center",
      gap: 16,
      paddingHorizontal: screenPadding,
      paddingVertical: 24,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: screenPadding,
      paddingVertical: 24,
    },
    panel: {
      width: "100%",
      maxWidth,
      alignSelf: "center",
      gap: 16,
    },
    title: {
      color: theme.text.primary,
      fontSize: 26,
      lineHeight: 34,
      fontWeight: "800",
      textAlign,
    },
    successText: {
      color: theme.state.success,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: "700",
      textAlign,
    },
    secondaryText: {
      color: theme.text.secondary,
      fontSize: 16,
      lineHeight: 24,
      textAlign,
    },
    card: {
      padding: 16,
      borderRadius: 14,
      backgroundColor: theme.surface.raised,
    },
    stateGroup: { gap: 8 },
    loadingRow: {
      minHeight: 48,
      flexDirection: rowDirection,
      alignItems: "center",
      gap: 8,
    },
    profileName: {
      color: theme.text.primary,
      fontSize: 22,
      lineHeight: 29,
      fontWeight: "800",
      textAlign,
    },
    identityLabel: {
      marginTop: 8,
      color: theme.text.secondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
      textAlign,
    },
    identityValue: {
      color: theme.text.primary,
      fontSize: 14,
      lineHeight: 21,
      textAlign,
    },
    errorText: {
      color: theme.state.error,
      fontSize: 14,
      lineHeight: 21,
      textAlign,
    },
    partialText: {
      color: theme.state.info,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: "700",
      textAlign,
    },
    actionGroup: { gap: 12 },
  });
}
