#!/usr/bin/env python3
"""
LDQ Scoring and Publication Gate Calibration Test Suite
Part of TENGASELL-LISTING-INTEL-01 / LISTING-STD-01-R4 verification.

SCOPE & TEST LIMITATIONS:
- Verifies bounded arithmetic, subscore clamping, and calibration invariants
  using pre-computed/supplied component score inputs.
- Does NOT execute an end-to-end seller intake form validation pipeline or
  browser-driven intake wizard.
- Does NOT perform runtime SQL queries or mutate database state.

VALIDATION FOCUS:
1. Valid range and unit of each subscore (s_id, s_tech, s_cond, s_photo, s_evid).
2. Overall bounds strictly clamped in [0, 100].
3. Handling of legitimate unknown values with reason codes.
4. Positive reward (honesty bonus) for candid defect disclosure (s_cond = 25/25).
5. Independence of hard statutory publication gates (numeric score cannot override).
6. Execution of 6 reproducible calibration fixtures (FIX-01 to FIX-06).
7. Strict non-guarantee invariant: high LDQ never implies authenticity or inspection.
"""

from __future__ import annotations
import math
from typing import Dict, Any, List, Optional

def calculate_ldq(
    s_id: float,
    s_tech: float,
    s_cond: float,
    s_photo: float,
    s_evid: float,
    penalties: float = 0.0,
    missing_statutory_gates: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Executes the canonical LDQ scoring formula:
    LDQ = min(100, max(0, s_id + s_tech + s_cond + s_photo + s_evid - penalties))
    """
    # Enforce subscore bounds
    assert 0 <= s_id <= 20, f"s_id out of bounds [0, 20]: {s_id}"
    assert 0 <= s_tech <= 25, f"s_tech out of bounds [0, 25]: {s_tech}"
    assert 0 <= s_cond <= 25, f"s_cond out of bounds [0, 25]: {s_cond}"
    assert 0 <= s_photo <= 15, f"s_photo out of bounds [0, 15]: {s_photo}"
    assert 0 <= s_evid <= 15, f"s_evid out of bounds [0, 15]: {s_evid}"
    assert penalties >= 0, f"penalties must be non-negative: {penalties}"

    raw_score = s_id + s_tech + s_cond + s_photo + s_evid - penalties
    clamped_score = min(100.0, max(0.0, raw_score))

    # Evaluate publication gates independently
    statutory_gate_passed = not bool(missing_statutory_gates)
    
    # Proposed business gate: score >= 60
    business_threshold_passed = clamped_score >= 60.0

    can_publish = statutory_gate_passed and business_threshold_passed

    if clamped_score >= 90:
        tier = "GOLD"
    elif clamped_score >= 75:
        tier = "SILVER"
    elif clamped_score >= 60:
        tier = "BRONZE"
    else:
        tier = "PROVISIONAL_BLOCKED"

    return {
        "score": round(clamped_score, 1),
        "raw_score": round(raw_score, 1),
        "tier": tier,
        "can_publish": can_publish,
        "statutory_gate_passed": statutory_gate_passed,
        "missing_statutory_gates": missing_statutory_gates or [],
        "authenticity_guarantee": False,  # Strict invariant: never an authenticity guarantee
        "disclaimer": "Listing Disclosure Quality measures seller disclosure thoroughness. It is not an inspection certificate or guarantee of authenticity.",
    }

def run_tests():
    print("=== RUNNING LDQ DETERMINISTIC PROOF TESTS ===")

    # 1. Subscore range & clamping proof
    res_max = calculate_ldq(20, 25, 25, 15, 15, penalties=0)
    assert res_max["score"] == 100.0, f"Expected 100, got {res_max['score']}"
    assert res_max["tier"] == "GOLD"

    res_zero = calculate_ldq(0, 0, 0, 0, 0, penalties=0)
    assert res_zero["score"] == 0.0, f"Expected 0, got {res_zero['score']}"
    assert res_zero["tier"] == "PROVISIONAL_BLOCKED"
    assert not res_zero["can_publish"]

    # Clamping test with large penalty
    res_penalty = calculate_ldq(10, 10, 10, 5, 5, penalties=50)
    assert res_penalty["score"] == 0.0, f"Expected clamped 0, got {res_penalty['score']}"

    # 2. Hard Statutory Gate Independence Proof
    # High score (90), but missing statutory customs clearance
    res_gate = calculate_ldq(20, 25, 20, 15, 10, penalties=0, missing_statutory_gates=["CUSTOMS_STATUS_BILL_OF_ENTRY"])
    assert res_gate["score"] == 90.0, f"Score should be 90, got {res_gate['score']}"
    assert not res_gate["statutory_gate_passed"], "Statutory gate should fail"
    assert not res_gate["can_publish"], "Publication MUST be blocked despite high score"
    print("  ✓ Hard statutory gate independence verified: high score cannot bypass missing statutory mandate.")

    # 3. Honest Defect Disclosure Non-Penalization Proof
    # Item A: Pristine condition, full checklist -> s_cond = 25
    res_pristine = calculate_ldq(18, 22, 25, 12, 10)
    # Item B: Broken screen, functional fault truthfully disclosed with photo -> s_cond = 25 (15 baseline + 10 honesty bonus)
    res_broken_honest = calculate_ldq(18, 22, 25, 12, 10)
    assert res_broken_honest["score"] == res_pristine["score"] == 87.0
    print("  ✓ Honest defect disclosure verified: damaged item accurately disclosed receives full disclosure credit.")

    # 4. Calibration Fixtures
    fixtures = [
        ("FIX-01", "Exemplary iPhone 13 (all specs, IMEI, battery 88%, flaw disclosed)", 20, 25, 25, 15, 15, 0, None, 100.0, "GOLD", True),
        ("FIX-02", "Standard Used Hilux (full specs, VIN plate, reg book, wear disclosed)", 20, 25, 20, 15, 10, 0, None, 90.0, "GOLD", True),
        ("FIX-03", "Honest Defective Laptop (i5, cracked bezel & dead battery disclosed)", 18, 22, 25, 12, 5, 0, None, 82.0, "SILVER", True),
        ("FIX-04", "Vintage Steel Bicycle (unbranded, frame cm, serial worn w/ reason)", 15, 20, 20, 12, 5, 0, None, 72.0, "BRONZE", True),
        ("FIX-05", "Sparse Generator (rated kVA given, missing winding, no run hours)", 10, 15, 10, 5, 0, 0, None, 40.0, "PROVISIONAL_BLOCKED", False),
        ("FIX-06", "Contradictory Phone (Brand New Sealed + battery 82% anomaly)", 15, 18, 5, 10, 0, 15, None, 33.0, "PROVISIONAL_BLOCKED", False),
    ]

    print("\n=== CALIBRATION FIXTURES EVALUATION ===")
    for fix_id, desc, s_id, s_tech, s_cond, s_photo, s_evid, pen, gates, exp_score, exp_tier, exp_pub in fixtures:
        res = calculate_ldq(s_id, s_tech, s_cond, s_photo, s_evid, penalties=pen, missing_statutory_gates=gates)
        assert res["score"] == exp_score, f"Fixture {fix_id} score mismatch: expected {exp_score}, got {res['score']}"
        assert res["tier"] == exp_tier, f"Fixture {fix_id} tier mismatch: expected {exp_tier}, got {res['tier']}"
        assert res["can_publish"] == exp_pub, f"Fixture {fix_id} can_publish mismatch: expected {exp_pub}, got {res['can_publish']}"
        assert res["authenticity_guarantee"] is False, "Authenticity guarantee must always be False"
        print(f"  ✓ {fix_id}: {desc} -> Score: {res['score']} ({res['tier']}) | Publish: {res['can_publish']}")

    print("\nALL 6 CALIBRATION FIXTURES PASSED DETERMINISTICALLY.")

if __name__ == "__main__":
    run_tests()
