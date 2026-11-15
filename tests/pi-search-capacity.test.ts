// tests/pi-search-capacity.benchmark.ts
// Capacity and latency benchmark for queryProductSearch() under scaling dataset sizes.
import { describe, it, expect } from "bun:test";
import {
  queryProductSearch,
  type SearchQueryInput,
} from "../mini-services/trade-engine/search-indexing";
import type { VehicleStore } from "../mini-services/trade-engine/vehicle-authority";

interface BenchmarkResult {
  size: number;
  label: string;
  runs: number;
  p50Ms: number;
  p95Ms: number;
  meanMs: number;
  heapDeltaKb: number;
  totalMatches: number;
  storeListCalls: number;
}

function createInMemoryStore(totalItems: number): { store: VehicleStore; getCallCount: () => number } {
  let listCalls = 0;
  const items: any[] = [];
  const facetValues: any[] = [];

  const makes = ["Toyota", "Nissan", "Ford", "Isuzu", "Honda", "Mercedes-Benz", "BMW", "Volkswagen"];
  const models = ["Hilux", "Land Cruiser", "Navara", "Ranger", "D-Max", "CR-V", "C-Class", "Golf"];
  const fuels = ["DIESEL", "PETROL", "HYBRID"];
  const transmissions = ["AUTOMATIC", "MANUAL"];
  const cities = ["Harare", "Bulawayo", "Mutare", "Gweru"];
  const conditions = ["excellent", "good", "fair", "poor"];
  const statuses = ["live", "live", "live", "live", "live", "ended", "sold"];

  for (let i = 1; i <= totalItems; i++) {
    const make = makes[i % makes.length];
    const model = models[i % models.length];
    const fuel = fuels[i % fuels.length];
    const transmission = transmissions[i % transmissions.length];
    const city = cities[i % cities.length];
    const condition = conditions[i % conditions.length];
    const status = statuses[i % statuses.length];
    const year = 2010 + (i % 15);
    const price = 5000 + (i % 40) * 1000;
    const mileage = 20000 + (i % 80) * 2500;

    const row = {
      id: i,
      auction_id: i,
      title: `${year} ${make} ${model} 4x4 Double Cab`,
      category_key: "VEHICLES_CARS",
      auction_status: status,
      price,
      currency: "USD",
      location: city,
      ending_time: new Date(Date.now() + ((i % 1440) + 60) * 60_000).toISOString(),
      sale_condition: condition,
      make,
      model,
      year,
      mileage,
      fuel,
      transmission,
      drivetrain: "4WD",
      body_type: "PICKUP_DOUBLE_CAB",
      exterior_colour: "White",
      inspection_grade: "B",
      roadworthy: 1,
      view_count: 50 + (i % 200),
      created_at: new Date(Date.now() - (i % 30) * 86400_000).toISOString(),
    };
    items.push(row);

    facetValues.push({
      id: i * 2 - 1,
      auction_id: i,
      attribute_key: "CUSTOMS_STATUS",
      facet_value_text: i % 2 === 0 ? "DUTY_PAID" : "BONDED",
      facet_value_number: null,
      facet_value_boolean: null,
    });
  }

  const store: VehicleStore = {
    async get(_table: string, id: number | string) {
      return items.find((it) => it.auction_id === Number(id)) ?? null;
    },
    async list(table: string, queryStr: string) {
      listCalls++;
      const sp = new URLSearchParams(queryStr);
      const limit = Number(sp.get("limit") ?? 250);
      const offset = Number(sp.get("offset") ?? 0);

      let target = table === "product_search_index" ? items : facetValues;
      // Simple memory filter matching
      for (const [k, v] of sp.entries()) {
        if (k === "limit" || k === "offset" || k === "order") continue;
        const matchEq = k.match(/^filter\[(\w+)\]\[\$eq\]$/);
        if (matchEq) {
          const col = matchEq[1];
          target = target.filter((r) => String(r[col]) === String(v));
        }
        const matchGte = k.match(/^filter\[(\w+)\]\[\$gte\]$/);
        if (matchGte) {
          const col = matchGte[1];
          target = target.filter((r) => Number(r[col]) >= Number(v));
        }
        const matchLte = k.match(/^filter\[(\w+)\]\[\$lte\]$/);
        if (matchLte) {
          const col = matchLte[1];
          target = target.filter((r) => Number(r[col]) <= Number(v));
        }
      }

      return target.slice(offset, offset + limit);
    },
    async create() { return null; },
    async update() { return false; },
  };

  return { store, getCallCount: () => listCalls };
}

async function benchmarkQuery(
  store: VehicleStore,
  query: SearchQueryInput,
  runs = 25,
): Promise<{ times: number[]; p50: number; p95: number; mean: number; total: number; heapDeltaKb: number }> {
  // Warmup
  await queryProductSearch(store, query);

  const initialHeap = process.memoryUsage().heapUsed;
  const times: number[] = [];
  let lastTotal = 0;

  for (let r = 0; r < runs; r++) {
    const start = performance.now();
    const res = await queryProductSearch(store, query);
    const end = performance.now();
    times.push(end - start);
    lastTotal = res.total;
  }

  const finalHeap = process.memoryUsage().heapUsed;
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const mean = times.reduce((acc, t) => acc + t, 0) / times.length;
  const heapDeltaKb = Math.round((finalHeap - initialHeap) / 1024);

  return { times, p50, p95, mean, total: lastTotal, heapDeltaKb };
}

describe("PI-01E Search Capacity & Performance Profile", () => {
  const datasetSizes = [50, 200, 500, 1000, 2000];
  const benchmarkResults: BenchmarkResult[] = [];

  for (const size of datasetSizes) {
    it(`evaluates dataset capacity at ${size} items with sub-millisecond to low-millisecond response`, async () => {
      const { store, getCallCount } = createInMemoryStore(size);

      // 1. Unfiltered live search
      const callsBefore = getCallCount();
      const qBroad: SearchQueryInput = {
        categoryKey: "VEHICLES_CARS",
        status: "live",
        limit: 48,
        offset: 0,
      };
      const broadMetrics = await benchmarkQuery(store, qBroad, 20);
      const callsAfter = getCallCount();

      benchmarkResults.push({
        size,
        label: "Broad live query + facets",
        runs: 20,
        p50Ms: Math.round(broadMetrics.p50 * 100) / 100,
        p95Ms: Math.round(broadMetrics.p95 * 100) / 100,
        meanMs: Math.round(broadMetrics.mean * 100) / 100,
        heapDeltaKb: broadMetrics.heapDeltaKb,
        totalMatches: broadMetrics.total,
        storeListCalls: callsAfter - callsBefore,
      });

      // Assertions
      expect(broadMetrics.p50).toBeLessThan(35); // 35ms budget for p50
      expect(broadMetrics.p95).toBeLessThan(75); // 75ms budget for p95
      expect(broadMetrics.total).toBeGreaterThan(0);

      // 2. High-selectivity compound filtered query
      const qSpecific: SearchQueryInput = {
        categoryKey: "VEHICLES_CARS",
        make: "Toyota",
        minYear: 2018,
        maxPrice: 30000,
        status: "live",
        order: "price_asc",
        limit: 24,
      };
      const specificMetrics = await benchmarkQuery(store, qSpecific, 15);
      expect(specificMetrics.p50).toBeLessThan(30);

      // 3. Deep pagination test: verifying deterministic pagination slice
      const page1 = await queryProductSearch(store, { ...qBroad, limit: 10, offset: 0 });
      const page2 = await queryProductSearch(store, { ...qBroad, limit: 10, offset: 10 });
      expect(page1.items.length).toBe(10);
      expect(page2.items.length).toBe(10);
      // Verify no overlap between page 1 and page 2
      const idsPage1 = new Set(page1.items.map((i: any) => i.auction_id));
      for (const item of page2.items) {
        expect(idsPage1.has(item.auction_id)).toBe(false);
      }
    });
  }

  it("prints performance profile summary table", () => {
    console.log("\n=== PI-01E SEARCH CAPACITY BENCHMARK SUMMARY ===");
    console.log(
      "Size".padEnd(8) +
      "Query Profile".padEnd(28) +
      "Matches".padEnd(12) +
      "p50 (ms)".padEnd(12) +
      "p95 (ms)".padEnd(12) +
      "Mean (ms)".padEnd(12) +
      "Heap (KB)"
    );
    console.log("-".repeat(95));
    for (const r of benchmarkResults) {
      console.log(
        String(r.size).padEnd(8) +
        r.label.padEnd(28) +
        String(r.totalMatches).padEnd(12) +
        String(r.p50Ms).padEnd(12) +
        String(r.p95Ms).padEnd(12) +
        String(r.meanMs).padEnd(12) +
        String(r.heapDeltaKb)
      );
    }
    console.log("=".repeat(95) + "\n");
    expect(benchmarkResults.length).toBe(datasetSizes.length);
  });
});
