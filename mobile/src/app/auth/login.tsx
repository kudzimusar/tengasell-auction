import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ElementRef } from "react";
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
import {
  type NxsTranslator,
} from "../../nxs/localization/catalog";
import { localizeKnownRuntimeMessage } from "../../nxs/localization/runtimeMessages";
import { useNxsText } from "../../nxs/localization/useNxsText";
import type { NxsTheme } from "../../nxs/tokens";

const BRAND = "TengaSell";

function loginErrorMessage(error: unknown, t: NxsTranslator): string {
  if (error instanceof TrailBaseError) {
    if (error.kind === "mfa-required") return t("login.mfaRequired");
    return localizeKnownRuntimeMessage(error.message, t, "login.signInFailed");
  }

  return error instanceof Error
    ? localizeKnownRuntimeMessage(error.message, t, "login.signInFailed")
    : t("login.signInFailed");
}

export default function LoginScreen() {
  const session = useSession();
  const { theme, screenPadding, windowClass, writingDirection } = useNxs();
  const t = useNxsText();
  const styles = useMemo(
    () => createStyles(theme, screenPadding, windowClass, writingDirection),
    [screenPadding, theme, windowClass, writingDirection],
  );
  const passwordRef = useRef<ElementRef<typeof TextInput>>(null);
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
      setError(t("login.enterCredentials"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await session.login(identifier, password);
      setPassword("");
      router.replace("/account");
    } catch (submitError) {
      setError(loginErrorMessage(submitError, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (session.phase === "booting") {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
        <View style={styles.center} accessible accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.state.loading} size="large" />
          <Text style={styles.secondaryText}>{t("login.restoringSession")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (session.phase === "signout-pending" ||
      session.phase === "signout-incomplete") {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
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
                onPress={() => void session.retryLogout()}
              />
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (session.phase === "network-degraded") {
    const recoveryMessage = localizeKnownRuntimeMessage(
      session.message,
      t,
      "login.recoveryUnavailableFallback",
    );

    return (
      <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
        <View style={styles.center}>
          <Text style={styles.title} accessibilityRole="header">
            {t("login.recoveryUnavailableTitle")}
          </Text>
          <Text style={styles.secondaryText} accessibilityRole="alert">
            ⚠ {recoveryMessage}
          </Text>
          <View style={styles.actionGroup}>
            <NxsButton
              label={t("login.retryRecovery")}
              onPress={() => void session.retrySessionRecovery()}
            />
            <NxsButton
              label={t("login.clearSavedSession")}
              variant="secondary"
              onPress={() => void session.logout()}
              accessibilityHint={t("login.clearSavedSessionHint")}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const sessionInvalidMessage = localizeKnownRuntimeMessage(
    session.message,
    t,
    "home.sessionInvalidFallback",
  );

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
              {t("login.title", { brand: BRAND })}
            </Text>
            <Text style={styles.secondaryText}>{t("login.intro")}</Text>

            {session.phase === "signed-out-locally" && (
              <View style={styles.warningBox} accessibilityRole="alert">
                <Text style={styles.warningText}>{t("session.signoutLocalOnly")}</Text>
              </View>
            )}

            {session.phase === "session-invalid" && (
              <View style={styles.warningBox} accessibilityRole="alert">
                <Text style={styles.warningText}>⚠ {sessionInvalidMessage}</Text>
              </View>
            )}

            {error && (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Text style={styles.errorText}>
                  {t("common.errorWithMessage", { message: error })}
                </Text>
              </View>
            )}

            <View style={styles.field}>
              <Text style={styles.label}>{t("login.emailOrUsername")}</Text>
              <TextInput
                value={identifier}
                onChangeText={setIdentifier}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                textContentType="username"
                accessibilityLabel={t("login.emailOrUsername")}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                blurOnSubmit={false}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>{t("login.password")}</Text>
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
                accessibilityLabel={t("login.password")}
                onSubmitEditing={() => void submit()}
                returnKeyType="go"
              />
              <NxsButton
                label={
                  passwordVisible
                    ? t("login.hidePassword")
                    : t("login.showPassword")
                }
                variant="quiet"
                onPress={() => setPasswordVisible((visible) => !visible)}
                accessibilityHint={t("login.passwordVisibilityHint")}
                accessibilityState={{ expanded: passwordVisible }}
              />
            </View>

            <NxsButton
              label={t("login.signIn")}
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
  writingDirection: "ltr" | "rtl",
) {
  const maxWidth = windowClass === "compact" ? undefined : 560;
  const textAlign = writingDirection === "rtl" ? "right" : "left";

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
      textAlign,
    },
    secondaryText: {
      color: theme.text.secondary,
      fontSize: 16,
      lineHeight: 24,
      textAlign,
    },
    field: { gap: 8 },
    label: {
      color: theme.text.primary,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
      textAlign,
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
      textAlign,
    },
    warningBox: {
      padding: 12,
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
      padding: 12,
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
    actionGroup: { gap: 12 },
  });
}
