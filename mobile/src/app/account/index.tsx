import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../../auth/session-context";
import { fetchAuthenticatedProfile } from "../../lib/trailbase";
import type { Profile } from "../../lib/types";

const TEAL = "#19717B";
const INK = "#0A0D10";
const MUTED = "#5C6B72";
const LINE = "#DDE5E9";
const DANGER = "#8F2D2D";
const MIN_TOUCH = 48;

export default function AccountScreen() {
  const session = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
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
      setProfile(null);
      router.replace("/auth/login");
      return;
    }
    if (session.phase !== "authenticated") {
      setProfile(null);
      return;
    }
    void loadProfile();
  }, [loadProfile, session.phase]);

  const signOut = async () => {
    setProfile(null);
    setError(null);
    await session.logout();
    router.replace("/");
  };

  if (session.phase === "booting") {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
        <View style={styles.center} accessibilityRole="status">
          <ActivityIndicator color={TEAL} size="large" />
          <Text style={styles.muted}>Restoring your secure session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (session.phase === "network-degraded") {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
        <View style={styles.panel}>
          <Text style={styles.title} accessibilityRole="header">
            Account temporarily unavailable
          </Text>
          <Text style={styles.muted} accessibilityRole="alert">
            {session.message ?? "The canonical TrailBase authority cannot be reached."}
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => void session.retrySessionRecovery()}
            accessibilityRole="button"
            accessibilityLabel="Retry session recovery"
          >
            <Text style={styles.primaryButtonText}>Retry session</Text>
          </Pressable>
          <Pressable
            style={styles.dangerButton}
            onPress={() => void signOut()}
            accessibilityRole="button"
            accessibilityLabel="Sign out and clear local session"
          >
            <Text style={styles.dangerButtonText}>Sign out on this device</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (session.phase !== "authenticated" || !session.identity) {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
        <View style={styles.center} accessibilityRole="status">
          <ActivityIndicator color={TEAL} />
          <Text style={styles.muted}>Returning to sign in…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
      <View style={styles.panel}>
        <Text style={styles.title} accessibilityRole="header">Your account</Text>
        <Text style={styles.statusText} accessibilityRole="status">
          Authenticated through canonical TrailBase
        </Text>

        <View style={styles.card}>
          {loading ? (
            <View style={styles.loadingRow} accessibilityRole="status">
              <ActivityIndicator color={TEAL} />
              <Text style={styles.muted}>Loading authenticated profile…</Text>
            </View>
          ) : (
            <>
              <Text style={styles.profileName}>
                {profile?.display_name || profile?.username || "Authenticated user"}
              </Text>
              {profile?.username && <Text style={styles.muted}>@{profile.username}</Text>}
              <Text style={styles.identityLabel}>TrailBase user ID</Text>
              <Text selectable style={styles.identityValue}>{session.identity.id}</Text>
            </>
          )}
        </View>

        {error && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => void loadProfile()}
              accessibilityRole="button"
              accessibilityLabel="Retry authenticated profile request"
            >
              <Text style={styles.secondaryButtonText}>Retry profile request</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          style={styles.dangerButton}
          onPress={() => void signOut()}
          accessibilityRole="button"
          accessibilityLabel="Sign out of TengaSell"
        >
          <Text style={styles.dangerButtonText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F9FA" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, padding: 24 },
  panel: { flex: 1, padding: 20, gap: 16 },
  title: { color: INK, fontSize: 24, lineHeight: 30, fontWeight: "800" },
  statusText: { color: TEAL, fontSize: 14, fontWeight: "700" },
  muted: { color: MUTED, fontSize: 14, lineHeight: 21 },
  card: {
    padding: 16,
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: "#FFFFFF",
  },
  loadingRow: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  profileName: { color: INK, fontSize: 20, fontWeight: "800" },
  identityLabel: { marginTop: 8, color: MUTED, fontSize: 12, fontWeight: "700" },
  identityValue: { color: INK, fontSize: 13 },
  errorBox: {
    padding: 12,
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E1A9A9",
    backgroundColor: "#FFF1F1",
  },
  errorText: { color: DANGER, lineHeight: 20 },
  primaryButton: {
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: TEAL,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  secondaryButton: {
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TEAL,
  },
  secondaryButtonText: { color: TEAL, fontWeight: "700" },
  dangerButton: {
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: DANGER,
  },
  dangerButtonText: { color: DANGER, fontSize: 15, fontWeight: "800" },
});
