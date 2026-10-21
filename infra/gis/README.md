# Tengasell GIS — Open-Source Mapping Infrastructure

No proprietary mapping APIs. Everything here is open-source and self-hostable.
The browser renders with **MapLibre GL JS** (BSD-2), tiles come from a
**TileServer GL**-compatible source, geocoding is **Nominatim/Photon**-compatible,
routing is **OSRM**-compatible. Contracts are identical in sandbox and production,
so the BFF (`src/lib/server/geo.ts`) never changes — only its base URL does.

## Architecture (data flow)

```
┌──────────────────── Browser (SPA at /) ─────────────────────┐
│  MapLibre GL JS map · address autocomplete · route line   │
│  checkout delivery quote · order courier tracking         │
└──────┬────────────────────────────────────────────────────┘
       │ fetch /api/geo/* (same origin, BFF)
┌──────▼────────────── Next.js server :3000 ────────────────┐
│  /api/geo/search  /api/geo/reverse  /api/geo/autocomplete │
│  /api/geo/route   /api/geo/quote                          │
│  TTL caches (geocode 60s · route 300s) + 2.5s timeouts   │
│  haversine×1.35 fallback when the stack is down           │
└──────┬────────────────────────────────────────────────────┘
       │ server-to-server (GIS_BASE_URL)
┌──────▼──────────── GIS stack :3004 ───────────────────────┐
│ sandbox: mini-services/gis-service (bun)                  │
│   /search /reverse /api          → curated Zim gazetteer  │
│   /route/v1 /table/v1            → Dijkstra road graph     │
│   /data/zimbabwe/{z}/{x}/{y}.pbf→ hand-rolled MVT encoder │
│   /styles/tengasell.json         → MapLibre style         │
│                                                            │
│ production: docker-compose.yml                             │
│   Nominatim (geocode)   ← Zimbabwe .osm.pbf                │
│   Photon (autocomplete) ← Africa photon extract            │
│   OSRM (route/table)    ← Zimbabwe car profile             │
│   TileServer GL (tiles) ← zimbabwe.mbtiles                 │
└────────────────────────────────────────────────────────────┘
```

Full-colour diagram: `public/gis-architecture.svg`

## Sandbox service (already running)

```bash
cd mini-services/gis-service
bun run dev                 # :3004 — spawned automatically by Next.js
curl localhost:3004/health  # cache hit/miss stats
```

The Next dev server owns the process (instrumentation + lazy ensure in the
BFF), so it survives sandbox shell reaping and restarts with the app.

## Production deployment

```bash
cd infra/gis
mkdir -p data/osrm data/tiles data/photon tileserver-config

# 1. Zimbabwe OSM extract (≈ 60 MB)
wget https://download.geofabrik.de/africa/zimbabwe-latest.osm.pbf -O data/osrm/zimbabwe-latest.osm.pbf

# 2. OSRM car-profile preprocessing (one-off, ≈ 5 min / 1 GB RAM)
docker compose run --rm osrm osrm-extract  -p /data/car.lua /data/zimbabwe-latest.osm.pbf
docker compose run --rm osrm osrm-partition /data/zimbabwe-latest.osrm
docker compose run --rm osrm osrm-customize /data/zimbabwe-latest.osrm

# 3. Tiles: build vector tiles from the same PBF with tilemaker
#    (config in tileserver-config/), or drop any zimbabwe.mbtiles:
#    tilemaker --input data/osrm/zimbabwe-latest.osm.pbf \
#              --output data/tiles/zimbabwe.mbtiles \
#              --config tileserver-config/tilemaker.json --process tilemaker-config/process.lua
cp tileserver-config/tengasell-style.json data/tiles/   # optional custom style

# 4. Photon Africa index (≈ 1.3 GB download, one-off)
wget https://download.graphhopper.com/public/photon/africa-latest.tar.bz2 \
    -O data/photon/africa-latest.tar.bz2

# 5. Bring the stack up
NOMINATIM_DB_PASSWORD=… docker compose up -d
```

Point the BFF at it:

```env
# .env of the Next.js app
GIS_BASE_URL=http://10.0.0.5:5000        # OSRM (default for route/table)
GEO_GEOCODE_BASE_URL=http://10.0.0.5:8088  # Nominatim + Photon
GEO_TILE_BASE_URL=http://10.0.0.5:8080      # TileServer GL
```

(The per-engine overrides are read by `src/lib/server/geo.ts` if you split
the stack across hosts; unset, everything uses `GIS_BASE_URL`.)

## API contract compatibility table

| Capability            | Sandbox (:3004)                        | Production                      | Client (BFF)                    |
| --------------------- | -------------------------------------- | ------------------------------- | ------------------------------- |
| Forward geocode       | `GET /search?q=&format=json`           | Nominatim 4.4 (same path)       | `geoSearch()`                   |
| Reverse geocode       | `GET /reverse?lat=&lon=&format=json`   | Nominatim 4.4                   | `geoReverse()`                  |
| Autocomplete          | `GET /api?q=&limit=&lat=&lon=`         | Photon 0.6 (same path)          | `geoAutocomplete()`             |
| Driving route         | `GET /route/v1/driving/{lon},{lat};…`  | OSRM v5 (same path)             | `geoRoute()`                    |
| Distance/duration mat. | `GET /table/v1/driving/{coords}`       | OSRM v5                         | (courier dispatch optimisation) |
| Vector tiles          | `GET /data/zimbabwe/{z}/{x}/{y}.pbf`   | TileServer GL `/data/v3/…`      | MapLibre source                 |
| Map style             | `GET /styles/tengasell.json`           | TileServer GL style + custom    | MapLibre `styleUrl`             |

Delivery quote domain formula (in the BFF, unchanged across stacks):
base fee (courier US$4 / nationwide US$2 / pickup US$0) + US$0.02/km beyond a
25 km free radius, capped (US$60 / US$45), ETA days = 1 + km/350.

## Caching layers

1. **GIS service** — internal TTL caches: geocode 24 h, route/table 1 h, tiles
   LRU 5 000 (places are static; tiles immutable per z/x/y).
2. **BFF** — geocode 60 s, route 300 s (bounded 600 keys).
3. **Browser** — MapLibre caches tiles per session; quote calls debounce on
   address select.

## Operational notes

- Sandbox gazetteer/road-graph: curated, ~80 places, ~25 road edges, real
  intercity road distances — data lives in
  `mini-services/gis-service/{gazetteer,roadgraph,zimbabwe-geo}.ts`.
- Vector tiles in the sandbox are produced by a hand-rolled MVT v2.1 encoder
  (`mvt.ts`): country border, roads, cities, water layers, z0–z14.
- No blue branding: Tengasell style uses teal `#19717B`, gold `#DFAE2E`,
  deep gold `#AF7A14`, light teal `#6CBEC2` over a warm paper background.
- Licence note: OSM data is ODbL 1.0 — keep the attribution string in the
  map component when serving production tiles.
