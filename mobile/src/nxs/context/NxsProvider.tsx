import {
  I18nManager,
  Platform,
  useColorScheme,
  useWindowDimensions,
  type ColorSchemeName,
} from "react-native";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";

import {
  nxsDarkTheme,
  nxsLightTheme,
  nxsTokens,
  type NxsTheme,
} from "../tokens";

export type NxsWindowClass = "compact" | "regular" | "wide";

export interface NxsContextValue {
  platform: "ios" | "android" | "other";
  viewportWidth: number;
  viewportHeight: number;
  fontScale: number;
  windowClass: NxsWindowClass;
  writingDirection: "ltr" | "rtl";
  colorScheme: Exclude<ColorSchemeName, null | undefined>;
  safeArea: EdgeInsets;
  screenPadding: number;
  theme: NxsTheme;
  tokens: typeof nxsTokens;
}

const NxsContext = createContext<NxsContextValue | null>(null);

function resolveWindowClass(width: number): NxsWindowClass {
  if (width < 600) return "compact";
  if (width < 840) return "regular";
  return "wide";
}

export function NxsProvider({ children }: { children: ReactNode }) {
  const { width, height, fontScale } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const colorScheme = systemScheme === "dark" ? "dark" : "light";
  const windowClass = resolveWindowClass(width);
  const screenPadding =
    windowClass === "compact"
      ? nxsTokens.spacing.screenCompact
      : nxsTokens.spacing.screenExpanded;

  const value = useMemo<NxsContextValue>(
    () => ({
      platform:
        Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "other",
      viewportWidth: width,
      viewportHeight: height,
      fontScale,
      windowClass,
      writingDirection: I18nManager.isRTL ? "rtl" : "ltr",
      colorScheme,
      safeArea,
      screenPadding,
      theme: colorScheme === "dark" ? nxsDarkTheme : nxsLightTheme,
      tokens: nxsTokens,
    }),
    [colorScheme, fontScale, height, safeArea, screenPadding, width, windowClass],
  );

  return <NxsContext.Provider value={value}>{children}</NxsContext.Provider>;
}

export function useNxs(): NxsContextValue {
  const value = useContext(NxsContext);
  if (!value) throw new Error("useNxs must be used within NxsProvider");
  return value;
}
