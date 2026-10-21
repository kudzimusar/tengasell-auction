"use client"

// Tengasell — the ONLY route. Mounts the original NXS app (hash-router).
import dynamic from "next/dynamic"

const TengasellApp = dynamic(
  () => import("@/components/tengasell/tengasell-app").then((m) => m.TengasellApp),
  { ssr: false },
)

export default function Page() {
  return <TengasellApp />
}
