// GET /api/pi/categories/[categoryKey]/filters — schema-driven filter metadata
import { NextRequest, NextResponse } from "next/server";
import { tbList, tbGet, TrailBaseError } from "@/lib/server/trailbase-admin";
import { categoryFilterMetadata } from "../../../../../../../mini-services/trade-engine/product-intelligence";
import type { VehicleStore } from "../../../../../../../mini-services/trade-engine/vehicle-authority";

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ categoryKey: string }> }
) {
  try {
    const { categoryKey } = await params;
    const metadata = await categoryFilterMetadata(serverStore, categoryKey);
    return NextResponse.json({ ok: true, ...metadata });
  } catch (err: any) {
    if (err instanceof TrailBaseError) {
      const status = err.status === 429 ? 429 : 503;
      const code = err.status === 429 ? "FILTERS_RATE_LIMITED" : "FILTERS_UNAVAILABLE";
      return NextResponse.json(
        { ok: false, code, error: "Category filters are temporarily unavailable." },
        { status },
      );
    }
    console.error("[api/pi/categories/[categoryKey]/filters]", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to load category filters" },
      { status: 500 }
    );
  }
}
