// GET /api/pi/search — structured discovery & facet search projection
import { NextRequest, NextResponse } from "next/server";
import { tbList, tbGet } from "@/lib/server/trailbase-admin";
import {
  SearchValidationError,
  queryProductSearch,
  type SearchQueryInput,
} from "../../../../../mini-services/trade-engine/search-indexing";
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

function optNumberParam(sp: URLSearchParams, key: string): number | null {
  const raw = sp.get(key);
  if (raw == null || raw === "") return null;
  return Number(raw);
}

function optBoolParam(sp: URLSearchParams, key: string): boolean | null {
  const raw = sp.get(key);
  if (raw == null || raw === "") return null;
  const lower = raw.trim().toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  throw new SearchValidationError("INVALID_BOOLEAN", `${key} must be true, false, 1, or 0`);
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    let parsedFacets: Record<string, unknown> | undefined;
    const rawFacets = sp.get("facets");
    if (rawFacets) {
      try {
        parsedFacets = JSON.parse(rawFacets);
      } catch {
        throw new SearchValidationError("INVALID_FACETS", "facets query parameter must be valid JSON");
      }
    }

    const query: SearchQueryInput = {
      search: sp.get("q") ?? sp.get("search") ?? undefined,
      categoryKey: sp.get("category") ?? sp.get("categoryKey") ?? undefined,
      city: sp.get("city") ?? undefined,
      condition: sp.get("condition") ?? undefined,
      status: sp.get("status") ?? "live",
      minPrice: optNumberParam(sp, "minPrice"),
      maxPrice: optNumberParam(sp, "maxPrice"),
      minYear: optNumberParam(sp, "minYear"),
      maxYear: optNumberParam(sp, "maxYear"),
      minMileage: optNumberParam(sp, "minMileage"),
      maxMileage: optNumberParam(sp, "maxMileage"),
      make: sp.get("make") ?? undefined,
      model: sp.get("model") ?? undefined,
      vehicleClass: sp.get("vehicleClass") ?? undefined,
      bodyType: sp.get("bodyType") ?? undefined,
      fuel: sp.get("fuel") ?? undefined,
      transmission: sp.get("transmission") ?? undefined,
      drivetrain: sp.get("drivetrain") ?? undefined,
      colour: sp.get("colour") ?? undefined,
      inspectionGrade: sp.get("inspectionGrade") ?? undefined,
      roadworthy: optBoolParam(sp, "roadworthy"),
      endingWithinMinutes: optNumberParam(sp, "endingWithinMinutes"),
      facets: parsedFacets,
      order: (sp.get("order") as SearchQueryInput["order"]) ?? "ending",
      limit: optNumberParam(sp, "limit") ?? 48,
      offset: optNumberParam(sp, "offset") ?? 0,
    };

    const res = await queryProductSearch(serverStore, query);
    return NextResponse.json({ ok: true, ...res });
  } catch (err: any) {
    if (err instanceof SearchValidationError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: err.statusCode },
      );
    }
    console.error("[api/pi/search]", err);
    return NextResponse.json(
      { ok: false, code: "SEARCH_FAILED", error: "Search is temporarily unavailable." },
      { status: 500 },
    );
  }
}
