import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "../../auth/session-context";
import { TrailBaseError } from "../../lib/trailbase";

const TEAL = "#19717B";
const INK = "#0A0D10";
const MUTED = "#5C6B72";
const LINE = "#DDE5E9";
const DANGER = "#8F2D2D";
const MIN_TOUCH = 48;

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
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
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
          <Text style={styles.title} accessibilityRole="header">Session recovery unavailable</Text>
          <Text style={styles.muted} accessibilityRole="alert">
            {session.message ?? "The canonical TrailBase authority cannot be reached."}
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => void session.retrySessionRecovery()}
            accessibilityRole="button"
            accessibilityLabel="Retry secure session recovery"
          >
            <Text style={styles.primaryButtonText}>Retry session recovery</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => void session.logout()}
            accessibilityRole="button"
            accessibilityLabel="Clear saved session on this device"
          >
            <Text style={styles.secondaryButtonText}>Clear saved session</Text>
          </Pressable>
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
        <View style={styles.panel}>
          <Text style={styles.title} accessibilityRole="header">Sign in to TengaSell</Text>
          <Text style={styles.muted}>
            Credentials are sent only to the canonical TrailBase authentication authority.
          </Text>

          {session.phase === "session-invalid" && session.message && (
            <View style={styles.warning} accessibilityRole="alert">
              <Text style={styles.warningText}>{session.message}</Text>
            </View>
          )}

          {error && (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.errorText}>{error}</Text>
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
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              style={styles.input}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              accessibilityLabel="Password"
              onSubmitEditing={() => void submit()}
              returnKeyType="go"
            />
          </View>

          <Pressable
            style={[styles.primaryButton, submitting && styles.disabledButton]}
            onPress={() => void submit()}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            accessibilityState={{ disabled: submitting, busy: submitting }}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" accessibilityLabel="Signing in" />
            ) : (
              <Text style={styles.primaryButtonText}>Sign in</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F9FA" },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, padding: 24 },
  panel: { flex: 1, padding: 20, gap: 16, justifyContent: "center" },
  title: { color: INK, fontSize: 24, lineHeight: 30, fontWeight: "800" },
  muted: { color: MUTED, fontSize: 14, lineHeight: 21 },
  field: { gap: 7 },
  label: { color: INK, fontSize: 14, fontWeight: "700" },
  input: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    fontSize: 16,
    color: INK,
  },
  warning: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#C6A652",
    backgroundColor: "#FFF9E8",
  },
  warningText: { color: "#5F4A17", lineHeight: 20 },
  errorBox: {
    padding: 12,
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
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: TEAL,
  },
  secondaryButtonText: { color: TEAL, fontSize: 15, fontWeight: "700" },
  disabledButton: { opacity: 0.6 },
});
