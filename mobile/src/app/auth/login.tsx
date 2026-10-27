import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../../auth/session-context";
import { TrailBaseError } from "../../lib/trailbase";
import { NxsButton } from "../../nxs/components/NxsButton";
import { useNxs } from "../../nxs/context/NxsProvider";
import type { NxsTheme } from "../../nxs/tokens";

function loginErrorMessage(error: unknown): string {
  if (error instanceof TrailBaseError) {
    if (error.kind === "mfa-required") {
      return "This account requires MFA. MFA entry is outside MOB-01; use an account without MFA for this verification unit.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "Sign in failed.";
}

export default function LoginScreen() {
  const session = useSession();
  const { theme, tokens, screenPadding, windowClass } = useNxs();
  const styles = useMemo(
    () => createStyles(theme, screenPadding, windowClass),
    [screenPadding, theme, windowClass],
  );
  const passwordRef = useRef<TextInput>(null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.phase === "authenticated") router.replace("/account");
  }, [session.phase]);

  const submit = async () => {
    if (!identifier.trim() || !password) {
      setError("Enter your email or username and password.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await session.login(identifier, password);
      setPassword("");
      router.replace("/account");
    } catch (submitError) {
      setError(loginErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
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
            Session recovery unavailable
          </Text>
          <Text style={styles.secondaryText} accessibilityRole="alert">
            ⚠ {session.message ?? "The canonical TrailBase authority cannot be reached."}
          </Text>
          <View style={styles.actionGroup}>
            <NxsButton
              label="Retry session recovery"
              onPress={() => void session.retrySessionRecovery()}
            />
            <NxsButton
              label="Clear saved session"
              variant="secondary"
              onPress={() => void session.logout()}
              accessibilityHint="Removes the locally stored TrailBase session from this device"
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.panel}>
            <Text style={styles.title} accessibilityRole="header">
              Sign in to TengaSell
            </Text>
            <Text style={styles.secondaryText}>
              Credentials are sent only to the canonical TrailBase authentication authority.
            </Text>

            {session.phase === "session-invalid" && session.message && (
              <View style={styles.warningBox} accessibilityRole="alert">
                <Text style={styles.warningText}>⚠ {session.message}</Text>
              </View>
            )}

            {error && (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>Error: {error}</Text>
              </View>
            )}

            <View style={styles.field}>
              <Text style={styles.label}>Email or username</Text>
              <TextInput
                value={identifier}
                onChangeText={setIdentifier}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textContentType="username"
                accessibilityLabel="Email or username"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                blurOnSubmit={false}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                ref={passwordRef}
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                secureTextEntry={!passwordVisible}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                accessibilityLabel="Password"
                onSubmitEditing={() => void submit()}
                returnKeyType="go"
              />
              <NxsButton
                label={passwordVisible ? "Hide password" : "Show password"}
                variant="quiet"
                onPress={() => setPasswordVisible((visible) => !visible)}
                accessibilityHint="Changes whether the password characters are visible on screen"
                accessibilityState={{ expanded: passwordVisible }}
              />
            </View>

            <NxsButton
              label="Sign in"
              loading={submitting}
              disabled={submitting}
              onPress={() => void submit()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(
  theme: NxsTheme,
  screenPadding: number,
  windowClass: "compact" | "regular" | "wide",
) {
  const maxWidth = windowClass === "compact" ? undefined : 560;

  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.surface.canvas },
    flex: { flex: 1 },
    scrollContent: {
      flexGrow: 1,
      justifyContent: "center",
      paddingHorizontal: screenPadding,
      paddingVertical: 24,
    },
    center: {
      flex: 1,
      width: "100%",
      maxWidth: 560,
      alignSelf: "center",
      justifyContent: "center",
      gap: 16,
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
    secondaryText: {
      color: theme.text.secondary,
      fontSize: 16,
      lineHeight: 24,
    },
    field: { gap: 8 },
    label: {
      color: theme.text.primary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
    },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: theme.border.strong,
      borderRadius: 10,
      backgroundColor: theme.surface.raised,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      lineHeight: 24,
      color: theme.text.primary,
    },
    warningBox: {
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border.warning,
      backgroundColor: theme.surface.raised,
    },
    warningText: { color: theme.state.warning, fontSize: 14, lineHeight: 21 },
    errorBox: {
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border.error,
      backgroundColor: theme.surface.raised,
    },
    errorText: { color: theme.state.error, fontSize: 14, lineHeight: 21 },
    actionGroup: { gap: 12 },
  });
}
