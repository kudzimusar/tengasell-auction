# Task 6-a — Location + Maps module (Z.ai Code)

## Scope
- New module `src/components/tengasell/map/` (5 files) + surgical integrations in
  `pages/item/shipping-payments.tsx`, `pages/account/profile.tsx`,
  `pages/sell/sell-new.tsx`, `pages/browse/filter-panel.tsx`.
- Nothing else touched. All `location.*` i18n keys (EN/JA) already present in
  `lib/tengasell/i18n.tsx` (added by main alongside 6-b paynow keys); no
  interpolation in `t()`, so distance strings are composed per-locale in
  components.

## Files (all verified live through the gateway :81, live TrailBase mode)
| File | What |
|---|---|
| `map/cities.ts` | `CityInfo` (6 cities, exact coords per spec), `ZIMBABWE_CITIES`, `cityInfo(name)` (case-insensitive, null-safe), `haversineKm(a,b)`, `nearestCity(lat,lng)`, `cityDistanceKm(from,to)` helper |
| `map/zimbabwe-map.tsx` | Hand-drawn SVG outline (~24 border points projected from lat/lng, viewBox 0 0 300 260), teal dots / gold `animate-ping` active, Kariba accent stroke, semantic tokens (fill-raised/stroke-border/fill-teal/fill-gold). Interactive mode = real `<button>` markers (size-11, aria-label "City — view listings", aria-pressed) when `onSelectCity` given; static `<circle>`+`<title>` otherwise. sr-only description "Map of Zimbabwe showing: …". `useReducedMotion` gates ping. |
| `map/location-card.tsx` | MapPin + city + province, haversine distance line (EN "~204 km from Mutare" / JA "Mutareから約204km", teal; <30 km → "Same city as your location" in text-ok), blurb (full mode), compact ZimbabweMap preview (h 120 / 100), "Get directions" external Google-Maps link (target _blank rel noreferrer noopener, whileTap). Props: city, fromCity?, compact?, className? |
| `map/osm-embed.tsx` | `<details>/<summary>` "Show detailed map" — iframe mounts ONLY on expand (0 iframes before, verified), OSM embed URL with bbox ±0.15/±0.1 + marker, `title="Map — {city}"`, `loading="lazy"`, `w-full h-56 rounded-card border border-border`; OSM copyright attribution link (44px target) always rendered |
| `map/use-geolocation.ts` | `requestLocation()` (explicit-only, ~10s timeout, maximumAge 10min) → nearestCity + `localStorage ts_geo_city`; `GeoError` class with code (denied/unavailable/unsupported) + `geoErrorMessage()` localized via i18n; `useGeoCity(): {city, requesting, request, error}` — restores persisted city post-hydration (deferred tick, no set-state-in-effect) |

## Integrations
- **shipping-payments.tsx**: "Use my location" pill (LocateFixed/Loader2, min-h-11, whileTap, role=alert error) → `LocationCard city fromCity={geo.city}` + `OsmEmbed` under shipping section; gated by `cityKnown`.
- **profile.tsx**: compact `LocationCard` in header (max-w-md), plain city chip fallback when city unknown.
- **sell-new.tsx**: decorative `ZimbabweMap height=140 activeCity={city}` under the city combobox, whole wrapper `aria-hidden` (combobox stays the accessible control).
- **filter-panel.tsx**: "Near me" outline button next to city select (desktop sidebar + mobile drawer) → `requestLocation()` → `onApply({city})`; localized error under it.

## Verification (live mode, gateway :81)
- `bun run lint` → exit 0, 0 findings project-wide. `bunx tsc --noEmit` → 0 errors in my files (3 pre-existing in gen-sql.ts / skills only).
- #/item/1020 shipping tab: card + map + pill + OSM all render; directions href `…destination=-17.8292,31.0522`; OSM iframe mounts on expand with exact bbox/title/loading.
- Geolocation: denied → "Location permission was denied…" (role=alert, i18n); success (API patched to Mutare/Gweru/Masvingo coords) → nearest city + `ts_geo_city` persisted, distance line renders and restores across reloads; same-city → green "Same city as your location".
- #/u/rufaro compact card (no blurb, 100px map); #/sell/new map preview follows combobox (Victoria Falls → far-west gold dot); #/search "Near me" selects nearest city + "City: Masvingo" chip (desktop + mobile drawer).
- Dark mode: outline fill rgb(26,38,38) (#1a2626 raised) / stroke rgb(39,53,53) (#273535 border) — semantic tokens adapt.
- JA locale: 現在地を使用 / 道順を表示 / 詳細地図を表示 / Mutareから約204km.
- Mobile 390×844: all module elements within viewport (card 12→378, map 126→264, pill 12→168, sell map 114→276). `documentElement.scrollWidth` = 399 — the 9px overflow comes from the pre-existing app-shell header account dropdown (group-hover block at right:399; same on #/ home, documented by agents 4-a/5-a). No new overflow introduced.
- Console: no errors (benign HMR/DevTools logs only).
- Screenshots in `/screenshots/`: 6a-item-shipping-desktop / 6a-item-osm-desktop / 6a-profile-desktop / 6a-sell-map-desktop / 6a-filter-near-me-desktop / 6a-item-shipping-mobile / 6a-profile-mobile / 6a-sell-map-mobile / 6a-item-shipping-dark.

## Fix made during verification (important pattern)
- `cn()` = clsx + **twMerge**; tailwind-merge's default config classifies every
  custom `text-*` token (text-label, text-teal, text-ok, text-title…) as the
  same "text-color" group, so mixing a custom size token + color token in one
  `cn()` call silently drops one (verified: `twMerge('text-label text-ok')` →
  `text-ok`, `'text-ok text-label'` → `text-label`). The location-card distance
  line originally lost its teal/ok color. Fixed by using plain template-literal
  classNames (the classes set different CSS properties, so they coexist fine).
  ⚠️ Same pitfall exists elsewhere (e.g. ui.tsx `PriceTag` runs size then tone
  through `cn()` — tone wins, size class is dropped); ui.tsx is main's file so
  left untouched, flagged in worklog.

## Notes for other agents
- Haversine Harare↔Bulawayo is ~366 km (great-circle); the "~439 km" figure
  that floated around in specs is the road distance. Distances shown are
  straight-line km, `compactNumber`-formatted.
- `ts_geo_city` localStorage key stores the user's nearest marketplace city —
  feel free to read it via `readSavedGeoCity()` if you want location context,
  but NEVER trigger geolocation automatically; only explicit user action.
- `ZimbabweMap` has an interactive mode (`onSelectCity` prop) ready for future
  category/city browse pages — currently used decoratively everywhere.
