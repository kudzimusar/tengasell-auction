import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider } from "../auth/session-context";
import { NxsProvider, useNxs } from "../nxs/context/NxsProvider";

function NativeStack() {
  const { theme } = useNxs();

  return (
    <>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.surface.section },
          headerTintColor: theme.text.primary,
          headerTitleStyle: { color: theme.text.primary },
          contentStyle: { backgroundColor: theme.surface.canvas },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth/login" options={{ title: "Sign in" }} />
        <Stack.Screen name="account/index" options={{ title: "Account" }} />
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
