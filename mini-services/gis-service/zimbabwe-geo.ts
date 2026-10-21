// zimbabwe-geo.ts — geographic data for the vector-tile pipeline.
//
// · Simplified Zimbabwe country outline (~32 lon/lat vertices, clockwise in
//   north-up map space): Zambezi/Zambia in the north, Victoria Falls + the
//   Botswana panhandle in the west, Limpopo/South Africa in the south and the
//   Eastern Highlands/Mozambique escarpment in the east.
// · Simplified water polygons: Lake Kariba + Lake Chivero.
// · City/town/suburb/airport/landmark points (derived from the gazetteer).
// · Major-road polylines (derived from the road graph edges).
//
// All geometry is [lng, lat] GeoJSON order.

import { GAZETTEER } from "./gazetteer";
import { getNode, ROAD_EDGES } from "./roadgraph";

export type LngLat = [number, number];

/** Simplified country border — clockwise (map view), closed implicitly. */
export const ZIMBABWE_BORDER: LngLat[] = [
  [25.27, -17.79], // Kazungula quad point (ZW/ZM/BW)
  [25.86, -17.92], // Victoria Falls — mid-Zambezi
  [26.45, -17.55],
  [27.05, -17.1],
  [27.6, -16.78],
  [28.12, -16.62], // into Lake Kariba
  [28.78, -16.52], // Kariba Dam
  [29.15, -16.15],
  [29.55, -15.85],
  [30.05, -15.65],
  [30.36, -15.6], // Kanyemba tripoint (ZW/ZM/MZ)
  [30.9, -16.2],
  [31.5, -16.65],
  [32.0, -17.1],
  [32.45, -17.6],
  [32.8, -18.1], // Nyanga ridge
  [32.9, -18.55],
  [33.1, -19.0], // Mutare border
  [33.15, -19.45],
  [33.0, -19.95],
  [32.8, -20.35],
  [32.45, -20.75],
  [32.15, -21.05],
  [31.95, -21.6],
  [31.9, -22.18], // Crooks Corner tripoint (ZW/MZ/ZA)
  [31.35, -22.28], // Limpopo westwards
  [30.9, -22.32],
  [30.45, -22.25],
  [30.0, -22.2], // Beitbridge
  [29.6, -22.3],
  [29.35, -22.15], // Shashe confluence
  [28.9, -21.8], // Shashe NW
  [28.5, -21.3],
  [28.1, -20.8],
  [27.82, -20.47], // Plumtree
  [27.4, -19.8],
  [27.1, -19.2],
  [26.8, -18.7],
  [26.2, -18.3],
  [25.7, -17.95],
];

export interface WaterPolygon {
  name: string;
  ring: LngLat[];
}

export const WATER_POLYGONS: WaterPolygon[] = [
  {
    name: "Lake Kariba",
    ring: [
      [27.9, -16.52],
      [28.0, -16.68],
      [28.2, -16.75],
      [28.4, -16.72],
      [28.6, -16.78],
      [28.75, -16.65],
      [28.8, -16.52], // dam wall
      [28.6, -16.45],
      [28.35, -16.4],
      [28.1, -16.42],
    ],
  },
  {
    name: "Lake Chivero",
    ring: [
      [30.78, -17.84],
      [30.82, -17.93],
      [30.88, -17.9],
      [30.86, -17.83],
    ],
  },
];

export interface CityPoint {
  name: string;
  lng: number;
  lat: number;
  /** city | town | district | suburb | airport | landmark */
  class: string;
  populationClass: string;
  capital: boolean;
  id: number;
  /** 1 city · 2 major town · 3 small town · 4 district · 0 other. */
  rank: number;
}

/** All gazetteer places as tile points (cities, towns, districts, …). */
export const CITY_POINTS: CityPoint[] = GAZETTEER.map((entry) => ({
  name: entry.name,
  lng: entry.lng,
  lat: entry.lat,
  class: entry.type,
  populationClass: entry.populationClass ?? "",
  capital: entry.id === "harare",
  id: entry.placeId,
  rank: entry.rank,
}));

export interface RoadLine {
  name: string;
  line: LngLat[];
}

/** One polyline per road-graph edge (straight corridor segments). */
export const ROAD_LINES: RoadLine[] = ROAD_EDGES.flatMap((edge) => {
  const a = getNode(edge.from);
  const b = getNode(edge.to);
  if (!a || !b) return [];
  return [
    {
      name: edge.name,
      line: [
        [a.lng, a.lat],
        [b.lng, b.lat],
      ],
    },
  ];
});

/** Zimbabwe bounds [minLng, minLat, maxLng, maxLat] (for the style `bounds`). */
export const ZIMBABWE_BOUNDS: [number, number, number, number] = [
  25.27, -22.4, 33.2, -15.6,
];
