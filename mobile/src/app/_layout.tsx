import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider } from "../auth/session-context";
import { NxsProvider, useNxs } from "../nxs/context/NxsProvider";
import { useNxsText } from "../nxs/localization/useNxsText";

function NativeStack() {
  const { theme, reduceMotion } = useNxs();
  const t = useNxsText();

  return (
    <>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          animation: reduceMotion === "enabled" ? "none" : "default",
          headerStyle: { backgroundColor: theme.surface.section },
          headerTintColor: theme.text.primary,
          headerTitleStyle: { color: theme.text.primary },
          contentStyle: { backgroundColor: theme.surface.canvas },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false, title: t("nav.home") }} />
        <Stack.Screen name="categories" options={{ headerShown: false, title: t("categories.title") }} />
        <Stack.Screen name="live" options={{ headerShown: false, title: t("live.title") }} />
        <Stack.Screen name="search" options={{ headerShown: false, title: t("nav.search") }} />
        <Stack.Screen name="orders" options={{ headerShown: false, title: t("orders.title") }} />
        <Stack.Screen name="you" options={{ headerShown: false, title: t("nav.you") }} />
        <Stack.Screen name="item/[id]" options={{ headerShown: false, title: t("item.fallbackTitle") }} />
        <Stack.Screen name="auth/login" options={{ title: t("nav.signIn") }} />
        <Stack.Screen name="account/index" options={{ title: t("nav.account") }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <NxsProvider>
        <SessionProvider>
          <NativeStack />
        </SessionProvider>
      </NxsProvider>
    </SafeAreaProvider>
  );
}
