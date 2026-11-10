// You tab — reuses the verified account screen and adds the shared nav bar.

import { StyleSheet, View } from "react-native";

import AccountScreen from "./account";
import { BottomNav } from "../components/BottomNav";

export default function YouScreen() {
  return (
    <View style={styles.wrap}>
      <AccountScreen />
      <BottomNav active="you" />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { flex: 1 } });
