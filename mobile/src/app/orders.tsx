// Orders tab — honest state: requires a session; order history lands with MOB-04.

import { useRouter } from "expo-router";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../components/BottomNav";
import { useSession } from "../auth/session-context";

export default function OrdersScreen() {
  const router = useRouter();
  const session = useSession();
  const signedIn = session.phase === "authenticated";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
      </View>

      <View style={styles.center}>
        <View style={styles.icon}>
          <Text style={styles.iconGlyph}>▤</Text>
        </View>
        <Text style={styles.heading}>{signedIn ? "No orders yet" : "Sign in to see your orders"}</Text>
        <Text style={styles.body}>
          {signedIn
            ? "When you win an auction, the order appears here with payment and delivery status."
            : "Your bids, wins and delivery status live behind your account."}
        </Text>
        {!signedIn && (
          <Pressable hitSlop={4} style={styles.cta} onPress={() => router.push("/auth/login" as never)} accessibilityRole="button">
            <Text style={styles.ctaText}>Sign in</Text>
          </Pressable>
        )}
      </View>
      <BottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F9FA" },
  header: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DCE4E8",
  },
  title: { fontSize: 17, fontWeight: "800", color: "#101619" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 8 },
  icon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "rgba(25,113,123,0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  iconGlyph: { fontSize: 24, color: "#19717B" },
  heading: { fontSize: 16, fontWeight: "800", color: "#101619", textAlign: "center" },
  body: { fontSize: 13, color: "#5C6B72", textAlign: "center", lineHeight: 19 },
  cta: {
    marginTop: 12,
    backgroundColor: "#19717B",
    paddingHorizontal: 22,
    paddingVertical: 11,
    minHeight: 48,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  ctaText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13.5 },
});
