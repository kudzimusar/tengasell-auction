import { useNetInfo } from "@react-native-community/netinfo";
import { useLocales } from "expo-localization";
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  useColorScheme,
  useWindowDimensions,
  type ColorSchemeName,
} from "react-native";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";

import { resolveNxsLocaleMode, type NxsLocaleMode } from "../localization/catalog";
import {
  nxsDarkTheme,
  nxsLightTheme,
  nxsTokens,
  type NxsTheme,
} from "../tokens";

export type NxsWindowClass = "compact" | "regular" | "wide";
export type NxsOrientation = "portrait" | "landscape";
export type NxsNetworkState = "online" | "offline" | "degraded" | "unknown";
export type NxsPreferenceState = "enabled" | "disabled" | "unknown";
export type NxsContrastPreference = "increased" | "standard" | "unknown";

export interface NxsContextValue {
  platform: "ios" | "android" | "other";
  viewportWidth: number;
  viewportHeight: number;
  orientation: NxsOrientation;
  fontScale: number;
  windowClass: NxsWindowClass;
  locale: string;
  language: string;
  localeMode: NxsLocaleMode;
  deviceLocale: string;
  deviceLanguage: string;
  writingDirection: "ltr" | "rtl";
  deviceWritingDirection: "ltr" | "rtl";
  colorScheme: Exclude<ColorSchemeName, null | undefined>;
  safeArea: EdgeInsets;
  keyboardVisible: boolean;
  reduceMotion: NxsPreferenceState;
  screenReader: NxsPreferenceState;
  contrastPreference: NxsContrastPreference;
  reduceTransparency: NxsPreferenceState;
  networkState: NxsNetworkState;
  networkType: string;
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

function preference(value: boolean | null): NxsPreferenceState {
  return value === null ? "unknown" : value ? "enabled" : "disabled";
}

export function NxsProvider({ children }: { children: ReactNode }) {
  const { width, height, fontScale } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const locales = useLocales();
  const netInfo = useNetInfo();

  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [reduceMotionValue, setReduceMotionValue] = useState<boolean | null>(null);
  const [screenReaderValue, setScreenReaderValue] = useState<boolean | null>(null);
  const [contrastPreference, setContrastPreference] =
    useState<NxsContrastPreference>("unknown");
  const [reduceTransparencyValue, setReduceTransparencyValue] =
    useState<boolean | null>(null);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduceMotionValue(value);
    });
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (active) setScreenReaderValue(value);
    });

    const reduceMotionSubscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotionValue,
    );
    const screenReaderSubscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReaderValue,
    );

    if (Platform.OS === "android") {
      void AccessibilityInfo.isHighTextContrastEnabled().then((value) => {
        if (active) setContrastPreference(value ? "increased" : "standard");
      });
    } else if (Platform.OS === "ios") {
      void AccessibilityInfo.isDarkerSystemColorsEnabled().then((value) => {
        if (active) setContrastPreference(value ? "increased" : "standard");
      });
      void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
        if (active) setReduceTransparencyValue(value);
      });
    }

    return () => {
      active = false;
      reduceMotionSubscription.remove();
      screenReaderSubscription.remove();
    };
  }, []);

  const systemLocale = locales[0];
  const deviceLocale = systemLocale?.languageTag ?? "und";
  const deviceLanguage = systemLocale?.languageCode ?? "und";
  const deviceWritingDirection =
    systemLocale?.textDirection === "rtl" ? "rtl" : "ltr";

  const localeMode = resolveNxsLocaleMode(process.env.EXPO_PUBLIC_NXS_LOCALE);
  const locale = localeMode;
  const language = localeMode === "ar-XB" ? "ar" : "en";
  const writingDirection = localeMode === "ar-XB" ? "rtl" : "ltr";

  const colorScheme = systemScheme === "dark" ? "dark" : "light";
  const windowClass = resolveWindowClass(width);
  const orientation: NxsOrientation = width > height ? "landscape" : "portrait";
  const screenPadding =
    windowClass === "compact"
      ? nxsTokens.spacing.screenCompact
      : nxsTokens.spacing.screenExpanded;

  const networkState: NxsNetworkState =
    netInfo.isConnected === false
      ? "offline"
      : netInfo.isConnected === true && netInfo.isInternetReachable === false
        ? "degraded"
        : netInfo.isConnected === true && netInfo.isInternetReachable === true
          ? "online"
          : "unknown";

  const value = useMemo<NxsContextValue>(
    () => ({
      platform:
        Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "other",
      viewportWidth: width,
      viewportHeight: height,
      orientation,
      fontScale,
      windowClass,
      locale,
      language,
      localeMode,
      deviceLocale,
      deviceLanguage,
      writingDirection,
      deviceWritingDirection,
      colorScheme,
      safeArea,
      keyboardVisible,
      reduceMotion: preference(reduceMotionValue),
      screenReader: preference(screenReaderValue),
      contrastPreference,
      reduceTransparency: preference(reduceTransparencyValue),
      networkState,
      networkType: netInfo.type,
      screenPadding,
      theme: colorScheme === "dark" ? nxsDarkTheme : nxsLightTheme,
      tokens: nxsTokens,
    }),
    [
      colorScheme,
      contrastPreference,
      deviceLanguage,
      deviceLocale,
      deviceWritingDirection,
      fontScale,
      height,
      keyboardVisible,
      language,
      locale,
      localeMode,
      netInfo.type,
      networkState,
      orientation,
      reduceMotionValue,
      reduceTransparencyValue,
      safeArea,
      screenPadding,
      screenReaderValue,
      width,
      windowClass,
      writingDirection,
    ],
  );

  return <NxsContext.Provider value={value}>{children}</NxsContext.Provider>;
}

export function useNxs(): NxsContextValue {
  const value = useContext(NxsContext);
  if (!value) throw new Error("useNxs must be used within NxsProvider");
  return value;
}
