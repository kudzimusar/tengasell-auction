// mobile/tests/privacy-boundary.test.mjs
// Verifies network boundary privacy, upstream TrailBase leak suppression,
// and safe vehicle product intelligence projection.

import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeAuctionPublicView } from "../src/lib/trailbase.ts";

test("PRIV-01: suppresses upstream TrailBase reserve_price leak", () => {
  const rawLeak = {
    id: 9001,
    title: "2018 Toyota Hilux 2.8 GD-6",
    reserve_price: 18500.0,
    current_price: 12000.0,
    status: "live",
  };

  const sanitized = sanitizeAuctionPublicView(rawLeak);

  // Must strictly null the numeric reserve figure to prevent public leakage
  assert.equal(sanitized.reserve_price, null, "reserve_price must be scrubbed to null");
  // Must truthfully reflect that a reserve applies without revealing its numerical value
  assert.equal(sanitized.reserve_disclosure, "RESERVE_APPLIES");
});

test("PRIV-02: preserves explicit canonical reserve disclosure when provided by backend", () => {
  const noReserveAuction = {
    id: 9002,
    title: "1997 Nissan Hardbody",
    reserve_disclosure: "NO_RESERVE",
    reserve_price: null,
  };

  const sanitizedNoReserve = sanitizeAuctionPublicView(noReserveAuction);
  assert.equal(sanitizedNoReserve.reserve_disclosure, "NO_RESERVE");
  assert.equal(sanitizedNoReserve.reserve_price, null);

  const upsetAuction = {
    id: 9003,
    title: "Heavy Equipment",
    reserve_disclosure: "UPSET_APPLIES",
    reserve_price: 50000,
  };

  const sanitizedUpset = sanitizeAuctionPublicView(upsetAuction);
  assert.equal(sanitizedUpset.reserve_disclosure, "UPSET_APPLIES");
  assert.equal(sanitizedUpset.reserve_price, null);
});

test("PRIV-03: scrubs sensitive vehicle identity tokens (VIN, chassis, engine numbers)", () => {
  const rawVehicle = {
    id: 9004,
    title: "2020 Isuzu D-Max",
    vin: "JAA1234567890ABCD",
    chassis_number: "CHS-998877",
    engine_number: "ENG-4JJ1-5544",
    registration_number: "AFK-1234",
    private_inspection_notes: "Internal seller notes: oil leak at gasket",
    vehicle_projection: {
      make: "Isuzu",
      model: "D-Max",
      year: 2020,
      vin: "JAA1234567890ABCD", // leaked inside vehicle projection
      verification_state: "UNVERIFIED",
    },
  };

  const sanitized = sanitizeAuctionPublicView(rawVehicle);

  // Root fields must be deleted
  assert.equal("vin" in sanitized, false, "root vin must be deleted");
  assert.equal("chassis_number" in sanitized, false, "chassis_number must be deleted");
  assert.equal("engine_number" in sanitized, false, "engine_number must be deleted");
  assert.equal("registration_number" in sanitized, false, "registration_number must be deleted");
  assert.equal("private_inspection_notes" in sanitized, false, "private_inspection_notes must be deleted");

  // Projection must mask VIN to classification only
  assert.ok(sanitized.vehicle_projection);
  assert.equal("vin" in sanitized.vehicle_projection, false, "projection vin must not exist");
  assert.equal(sanitized.vehicle_projection.vin_classification, "RECORDED");
  assert.equal(sanitized.vehicle_projection.verification_state, "UNVERIFIED");
});

test("PRIV-04: defaults vehicle verification state to UNVERIFIED unless explicitly VERIFIED", () => {
  const unverifiedAuction = {
    id: 9005,
    title: "2015 Mazda Demio",
    vehicle_projection: {
      make: "Mazda",
      model: "Demio",
      year: 2015,
      // No verification_state provided
    },
  };

  const sanitized = sanitizeAuctionPublicView(unverifiedAuction);
  assert.equal(sanitized.vehicle_projection?.verification_state, "UNVERIFIED");
});
