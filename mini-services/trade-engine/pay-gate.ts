// pay-gate.ts — trade-engine side of the R6 mock/live payment safety.
//
// The engine's `order:pay` RPC settles orders for the "classic" methods
// (EcoCash direct / ZIPIT / card forms / PayPal / COD) — none of which
// move real money. On a production deployment those methods must NOT be
// able to confirm a payment, so the handler refuses unless simulated
// settlement is explicitly allowed:
//
//   ALLOW_SIMULATED_PAYMENTS=1|true  → allowed (dev sandbox / demo)
//   ALLOW_SIMULATED_PAYMENTS=0|false  → blocked
//   unset                            → allowed only when NODE_ENV is not
//                                      "production" (dev default);
//                                      production processes fail closed.
//
// The Next app passes an explicit value when it spawns the engine
// (services-spawn.ts), so dev flows keep working while production
// deployments stay blocked even when the engine runs detached.

/** Parse the ALLOW_SIMULATED_PAYMENTS flag (null = unset). */
function explicitFlag(env: NodeJS.ProcessEnv): boolean | null {
  const v = env.ALLOW_SIMULATED_PAYMENTS;
  if (v == null || v === "") return null;
  const t = String(v).trim().toLowerCase();
  if (t === "1" || t === "true" || t === "yes" || t === "on") return true;
  if (t === "0" || t === "false" || t === "no" || t === "off") return false;
  return null;
}

/** Whether the engine may settle orders via simulated (non-gateway) methods. */
export function simulatedPaymentsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = explicitFlag(env);
  if (explicit != null) return explicit;
  return process.env.NODE_ENV !== "production";
}
