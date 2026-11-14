// POST /api/pi/compare — category-aware product comparison with privacy & public visibility guarantees
import { NextRequest, NextResponse } from "next/server";
import { tbList, tbGet } from "@/lib/server/trailbase-admin";
import {
  ProductIntelligenceError,
  productCompare,
} from "../../../../../mini-services/trade-engine/product-intelligence";
import type { VehicleStore } from "../../../../../mini-services/trade-engine/vehicle-authority";

export const runtime = "nodejs";

const serverStore: VehicleStore = {
  async get(table: string, id: number | string) {
    return await tbGet(table, id);
  },
  async list(table: string, queryStr: string) {
    const params: Record<string, string | number> = {};
    const sp = new URLSearchParams(queryStr);
    for (const [k, v] of sp.entries()) params[k] = v;
    return await tbList(table, params);
  },
  async create() { return null; },
  async update() { return false; },
};

function compareErrorStatus(code: string): number {
  switch (code) {
    case "COMPARE_LISTING_NOT_FOUND":
      return 404;
    case "COMPARE_LISTING_NOT_PUBLIC":
      return 403;
    case "COMPARE_MIN_ITEMS":
    case "COMPARE_MAX_ITEMS":
    case "COMPARE_DUPLICATE_ITEMS":
    case "COMPARE_INVALID_ID":
    case "COMPARE_INVALID_INPUT":
      return 400;
    default:
      return 400;
  }
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, code: "COMPARE_INVALID_JSON", error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const auctionIds = (body as Record<string, unknown>)?.auctionIds;
    if (!Array.isArray(auctionIds)) {
      return NextResponse.json(
        { ok: false, code: "COMPARE_INVALID_INPUT", error: "auctionIds array is required." },
        { status: 400 },
      );
    }

    const comparison = await productCompare(serverStore, auctionIds as number[]);
    return NextResponse.json({ ok: true, comparison });
  } catch (err: any) {
    if (err instanceof ProductIntelligenceError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: compareErrorStatus(err.code) },
      );
    }
    console.error("[api/pi/compare]", err);
    return NextResponse.json(
      { ok: false, code: "COMPARE_FAILED", error: "Comparison is temporarily unavailable." },
      { status: 500 },
    );
  }
}
