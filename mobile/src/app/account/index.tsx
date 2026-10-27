import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../../auth/session-context";
import { fetchAuthenticatedProfile } from "../../lib/trailbase";
import type { Profile } from "../../lib/types";
import { NxsButton } from "../../nxs/components/NxsButton";
import { useNxs } from "../../nxs/context/NxsProvider";
import type { NxsTheme } from "../../nxs/tokens";

export default function AccountScreen() {
  const session = useSession();
  const { theme, screenPadding, windowClass } = useNxs();
  const styles = useMemo(
    () => createStyles(theme, screenPadding, windowClass),
    [screenPadding, theme, windowClass],
  );
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          ? loadError.message
          : "Authenticated profile request failed.",
      );
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session.phase === "anonymous" || session.phase === "session-invalid") {
      router.replace("/auth/login");
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
              ? loadError.message
              : "Authenticated profile request failed.",
          );
          setLoading(false);
        },
      );

    return () => {
      active = false;
    };
  }, [session]);

  const signOut = async () => {
    setProfile(null);
    setError(null);
    await session.logout();
    router.replace("/");
  };

  if (session.phase === "booting") {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
        <View style={styles.center} accessible accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.state.loading} size="large" />
          <Text style={styles.secondaryText}>Restoring your secure session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (session.phase === "network-degraded") {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
        <View style={styles.center}>
          <Text style={styles.title} accessibilityRole="header">
            Account temporarily unavailable
          </Text>
          <Text style={styles.secondaryText} accessibilityRole="alert">
            ⚠ {session.message ?? "The canonical TrailBase authority cannot be reached."}
          </Text>
          <View style={styles.actionGroup}>
            <NxsButton
              label="Retry session"
              onPress={() => void session.retrySessionRecovery()}
            />
            <NxsButton
              label="Sign out on this device"
              variant="destructive"
              onPress={() => void signOut()}
              accessibilityHint="Clears this device session and returns to the public home screen"
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (session.phase !== "authenticated" || !session.identity) {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
        <View style={styles.center} accessible accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.state.loading} />
          <Text style={styles.secondaryText}>Returning to sign in…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.panel}>
          <Text style={styles.title} accessibilityRole="header">
            Your account
          </Text>
          <Text style={styles.successText} accessible accessibilityLiveRegion="polite">
            ✓ Authenticated through canonical TrailBase
          </Text>

          <View style={styles.card}>
            {loading ? (
              <View style={styles.loadingRow} accessible accessibilityLiveRegion="polite">
                <ActivityIndicator color={theme.state.loading} />
                <Text style={styles.secondaryText}>Loading authenticated profile…</Text>
              </View>
            ) : error ? (
              <View style={styles.stateGroup} accessibilityRole="alert">
                <Text style={styles.errorText}>Error: {error}</Text>
                <NxsButton
                  label="Retry profile request"
                  variant="secondary"
                  onPress={() => void retryProfile()}
                />
              </View>
            ) : profile ? (
              <View style={styles.stateGroup}>
                <Text style={styles.profileName}>
                  {profile.display_name || profile.username || "Authenticated user"}
                </Text>
                {profile.username && (
                  <Text style={styles.secondaryText}>@{profile.username}</Text>
                )}
                <Text style={styles.identityLabel}>TrailBase user ID</Text>
                <Text selectable style={styles.identityValue}>
                  {session.identity.id}
                </Text>
              </View>
            ) : (
              <View style={styles.stateGroup} accessibilityRole="alert">
                <Text style={styles.partialText}>ℹ Profile details are incomplete.</Text>
                <Text style={styles.secondaryText}>
                  The authenticated session remains valid, but TrailBase did not return a profile record.
                </Text>
                <Text style={styles.identityLabel}>TrailBase user ID</Text>
                <Text selectable style={styles.identityValue}>
                  {session.identity.id}
                </Text>
                <NxsButton
                  label="Retry profile request"
                  variant="secondary"
                  onPress={() => void retryProfile()}
                />
              </View>
            )}
          </View>

          <NxsButton
            label="Sign out"
            variant="destructive"
            onPress={() => void signOut()}
            accessibilityHint="Ends the local session and requests canonical TrailBase logout"
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
) {
  const maxWidth = windowClass === "compact" ? undefined : 640;

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
    },
    successText: {
      color: theme.state.success,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: "700",
    },
    secondaryText: { color: theme.text.secondary, fontSize: 16, lineHeight: 24 },
    card: {
      padding: 16,
      borderRadius: 14,
      backgroundColor: theme.surface.raised,
    },
    stateGroup: { gap: 8 },
    loadingRow: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    profileName: {
      color: theme.text.primary,
      fontSize: 22,
      lineHeight: 29,
      fontWeight: "800",
    },
    identityLabel: {
      marginTop: 8,
      color: theme.text.secondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "700",
    },
    identityValue: { color: theme.text.primary, fontSize: 14, lineHeight: 21 },
    errorText: { color: theme.state.error, fontSize: 14, lineHeight: 21 },
    partialText: {
      color: theme.state.info,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: "700",
    },
    actionGroup: { gap: 12 },
  });
}
