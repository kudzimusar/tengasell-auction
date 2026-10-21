"use client"

// Theme provider — mounts next-themes for the whole app. The app-shell's
// dark-mode toggle calls useTheme().setTheme(); without this provider that
// call was a silent no-op (theme toggle did nothing). attribute="class"
// matches the .dark{} token variants in globals.css.

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
