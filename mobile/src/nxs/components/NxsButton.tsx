import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from "react-native";

import { useNxs } from "../context/NxsProvider";
import { useNxsText } from "../localization/useNxsText";

export type NxsButtonVariant = "primary" | "secondary" | "destructive" | "quiet";

interface NxsButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  variant?: NxsButtonVariant;
  loading?: boolean;
}

export function NxsButton({
  label,
  variant = "primary",
  loading = false,
  disabled,
  accessibilityLabel,
  accessibilityState,
  ...props
}: NxsButtonProps) {
  const { theme, tokens } = useNxs();
  const t = useNxsText();
  const blocked = Boolean(disabled || loading);
  const spokenLabel = accessibilityLabel ?? label;

  const styles = StyleSheet.create({
    base: {
      minHeight: tokens.touch.minimum,
      minWidth: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.group,
      borderRadius: tokens.radius.control,
      borderWidth: variant === "primary" ? 0 : 1,
      borderColor:
        variant === "destructive"
          ? theme.action.destructive
          : variant === "quiet"
            ? "transparent"
            : theme.action.secondary,
      backgroundColor: variant === "primary" ? theme.action.primary : "transparent",
    },
    pressed: {
      opacity: 0.78,
    },
    disabled: {
      opacity: 0.55,
    },
    label: {
      ...tokens.typography.label,
      color:
        variant === "primary"
          ? theme.text.inverse
          : variant === "destructive"
            ? theme.action.destructive
            : theme.action.secondary,
      textAlign: "center",
    },
  });

  return (
    <Pressable
      {...props}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={spokenLabel}
      accessibilityState={{
        ...accessibilityState,
        disabled: blocked,
        busy: loading,
      }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        pressed && !blocked && styles.pressed,
        blocked && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "primary" ? theme.text.inverse : theme.action.primary}
          accessibilityLabel={t("common.inProgress", { action: spokenLabel })}
        />
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
    </Pressable>
  );
}
