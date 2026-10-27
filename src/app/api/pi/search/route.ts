// GET /api/pi/search — structured discovery & facet search projection
import { NextRequest, NextResponse } from "next/server";
import { tbList, tbGet } from "@/lib/server/trailbase-admin";
import { queryProductSearch, type SearchQueryInput } from "../../../../../mini-services/trade-engine/search-indexing";
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

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const query: SearchQueryInput = {
      search: sp.get("q") ?? sp.get("search") ?? undefined,
      categoryKey: sp.get("category") ?? sp.get("categoryKey") ?? undefined,
      city: sp.get("city") ?? undefined,
      condition: sp.get("condition") ?? undefined,
      status: sp.get("status") ?? "live",
      minPrice: sp.get("minPrice") ? Number(sp.get("minPrice")) : null,
      maxPrice: sp.get("maxPrice") ? Number(sp.get("maxPrice")) : null,
      minYear: sp.get("minYear") ? Number(sp.get("minYear")) : null,
      maxYear: sp.get("maxYear") ? Number(sp.get("maxYear")) : null,
      minMileage: sp.get("minMileage") ? Number(sp.get("minMileage")) : null,
      maxMileage: sp.get("maxMileage") ? Number(sp.get("maxMileage")) : null,
      make: sp.get("make") ?? undefined,
      model: sp.get("model") ?? undefined,
      vehicleClass: sp.get("vehicleClass") ?? undefined,
      bodyType: sp.get("bodyType") ?? undefined,
      fuel: sp.get("fuel") ?? undefined,
      transmission: sp.get("transmission") ?? undefined,
      drivetrain: sp.get("drivetrain") ?? undefined,
      colour: sp.get("colour") ?? undefined,
      inspectionGrade: sp.get("inspectionGrade") ?? undefined,
      roadworthy: sp.get("roadworthy") ? sp.get("roadworthy") === "true" || sp.get("roadworthy") === "1" : null,
      order: (sp.get("order") as any) ?? "ending",
      limit: sp.get("limit") ? Number(sp.get("limit")) : 48,
      offset: sp.get("offset") ? Number(sp.get("offset")) : 0,
    };

    const res = await queryProductSearch(serverStore, query);
    return NextResponse.json({ ok: true, ...res });
  } catch (err: any) {
    console.error("[api/pi/search]", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Search failed" },
      { status: 500 }
    );
  }
}
