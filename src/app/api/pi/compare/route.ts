// POST /api/pi/compare — category-aware product comparison with privacy guarantees
import { NextRequest, NextResponse } from "next/server";
import { tbList, tbGet } from "@/lib/server/trailbase-admin";
import { productCompare } from "../../../../../mini-services/trade-engine/product-intelligence";
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const auctionIds = Array.isArray(body.auctionIds) ? body.auctionIds : [];
    if (!auctionIds.length) {
      return NextResponse.json(
        { ok: false, error: "auctionIds array is required" },
        { status: 400 }
      );
    }
    const boundedIds = auctionIds.slice(0, 3);
    const comparison = await productCompare(serverStore, boundedIds);
    return NextResponse.json({ ok: true, comparison });
  } catch (err: any) {
    console.error("[api/pi/compare]", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Comparison failed" },
      { status: 500 }
    );
  }
}
