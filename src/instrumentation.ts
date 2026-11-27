export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/server/scheduler")
    startScheduler()

    // Paynow completion sweep (live mode only — see
    // src/lib/server/paynow-reconcile.ts). Webhook-independent settlement:
    // polls pending paynow_sessions on Paynow every 60s so a buyer's
    // completed payment settles even if the resulturl webhook is dropped.
    const { startPaynowSweep } = await import("@/lib/server/paynow-reconcile")
    startPaynowSweep()
  }
}
