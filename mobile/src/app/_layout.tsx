import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider } from "../auth/session-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="auth/login" options={{ title: "Sign in" }} />
          <Stack.Screen name="account/index" options={{ title: "Account" }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
