// registers-meta.ts — the register catalogue powering the generic register
// engine (one table, per-register filters) + the admin register picker.

export const REGISTERS = [
  "strategy",
  "entity",
  "ownership",
  "directors",
  "corporate_policies",
  "delegated_authority",
  "contracts",
  "employees",
  "contractors",
  "assets",
  "licenses",
  "domains",
  "insurance",
  "procurement",
  "vendors",
  "approvals",
  "integrations",
  "regulatory",
  "notices",
  "compliance_calendar",
] as const;

export type RegisterName = (typeof REGISTERS)[number];

export function isRegister(name: string): name is RegisterName {
  return (REGISTERS as readonly string[]).includes(name);
}

/** Registers stored in their own dedicated tables (still served via the
 *  generic register endpoints for a single admin UI). */
export const DEDICATED: Record<string, string> = {
  strategy: "strategy",
  compliance_calendar: "compliance_calendar",
};
