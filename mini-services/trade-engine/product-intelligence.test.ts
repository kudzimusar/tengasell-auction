/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import { resolveEffectiveFact, type PiFact } from "./product-intelligence";

const policy = [
  { source_class: "SELLER_DECLARED" as const, trust_rank: 10, verification_required: 0 },
  { source_class: "DOCUMENT_DERIVED" as const, trust_rank: 20, verification_required: 1 },
  { source_class: "SYSTEM_DERIVED" as const, trust_rank: 30, verification_required: 1 },
  { source_class: "INSPECTOR_VERIFIED" as const, trust_rank: 40, verification_required: 1 },
  { source_class: "EXTERNAL_VERIFIED" as const, trust_rank: 50, verification_required: 1 },
];

const fact = (id: number, source_class: PiFact["source_class"], value: number, extra: Partial<PiFact> = {}): PiFact => ({
  id,
  source_class,
  verification_state: source_class === "SELLER_DECLARED" ? "UNVERIFIED" : "VERIFIED",
  value_decimal: value,
  measurement_unit: "km",
  asserted_at: `2026-01-${String(id).padStart(2, "0")}T00:00:00Z`,
  ...extra,
});

test("inspection wins while preserving lower-trust odometer disagreement", () => {
  const result = resolveEffectiveFact([
    fact(1, "SELLER_DECLARED", 87_000),
    fact(2, "INSPECTOR_VERIFIED", 91_320),
  ], [], policy);
  expect(result.assertion?.id).toBe(2);
  expect(result.assertion?.value_decimal).toBe(91_320);
  expect(result.conflict).toBe("LOWER_TRUST_DISAGREEMENT");
});

test("equal-trust disagreement has no arbitrary buyer-facing winner", () => {
  const result = resolveEffectiveFact([
    fact(1, "INSPECTOR_VERIFIED", 91_320),
    fact(2, "INSPECTOR_VERIFIED", 91_450),
  ], [], policy);
  expect(result.assertion).toBeNull();
  expect(result.conflict).toBe("PEER_CONFLICT");
});

test("superseded, rejected and expired assertions are excluded", () => {
  const facts = [
    fact(1, "SELLER_DECLARED", 87_000),
    fact(2, "SELLER_DECLARED", 88_000),
    fact(3, "INSPECTOR_VERIFIED", 91_320, { verification_state: "REJECTED" }),
    fact(4, "EXTERNAL_VERIFIED", 92_000, { valid_until: "2025-01-01T00:00:00Z" }),
  ];
  const result = resolveEffectiveFact(
    facts,
    [{ from_assertion_id: 2, to_assertion_id: 1, link_type: "SUPERSEDES" }],
    policy,
    "2026-01-01T00:00:00Z",
  );
  expect(result.assertion?.id).toBe(2);
  expect(result.conflict).toBe("NONE");
});

test("equivalent peer assertions are deterministic without timestamp authority", () => {
  const result = resolveEffectiveFact([
    fact(9, "DOCUMENT_DERIVED", 87_000),
    fact(4, "DOCUMENT_DERIVED", 87_000),
  ], [], policy);
  expect(result.assertion?.id).toBe(4);
  expect(result.conflict).toBe("NONE");
});
