"use client";

// Tengasell Location & Maps — Zimbabwe place data + geo helpers.
//
// Taxonomy coverage: the 6 marketplace cities (with marketing blurbs) PLUS
// every town and growth point in the GIS gazetteer — all 64 administrative
// districts and their district centres per Wikipedia "Districts of
// Zimbabwe", geocoded from Wikipedia coordinate data. Coordinates match the
// GIS service gazetteer exactly (mini-services/gis-service/gazetteer.ts is
// the source of truth for this generated list).
//
// The 6 cities stay first-class (ZIMBABWE_CITIES drives the SVG map and the
// marketplace-hub UX); ZW_TOWNS extends search, filters, listing locations,
// distances and nearest-place resolution to every small town in Zimbabwe.

export interface CityInfo {
  name: string;
  lat: number;
  lng: number;
  province: string;
  /** Marketing blurb — only the 6 marketplace cities have one. */
  blurb?: string;
  /** Population class for map/stats (e.g. "90k"); empty for tiny places. */
  populationClass?: string;
}

/** The 6 marketplace cities (hub UX + SVG map markers). */
export const ZIMBABWE_CITIES: CityInfo[] = [
  {
    name: "Harare",
    lat: -17.8292,
    lng: 31.0522,
    province: "Harare Province",
    populationClass: "1.6M",
    blurb: "The capital and commercial hub — most listings and same-day courier pickup.",
  },
  {
    name: "Bulawayo",
    lat: -20.15,
    lng: 28.5873,
    province: "Bulawayo Province",
    populationClass: "700k",
    blurb: "Second city and industrial heart of Matabeleland, on the Bulawayo–Harare corridor.",
  },
  {
    name: "Mutare",
    lat: -18.9707,
    lng: 32.5707,
    province: "Manicaland",
    populationClass: "270k",
    blurb: "Eastern border city and gateway to Mozambique, below the Eastern Highlands.",
  },
  {
    name: "Gweru",
    lat: -19.45,
    lng: 29.8167,
    province: "Midlands",
    populationClass: "160k",
    blurb: "Central city at Zimbabwe's crossroads — halfway between Harare and Bulawayo.",
  },
  {
    name: "Masvingo",
    lat: -20.0744,
    lng: 30.889,
    province: "Masvingo Province",
    populationClass: "110k",
    blurb: "Southeastern city close to the Great Zimbabwe ruins and the Limpopo belt.",
  },
  {
    name: "Victoria Falls",
    lat: -17.9316,
    lng: 25.8318,
    province: "Matabeleland North",
    populationClass: "35k",
    blurb: "Tourism town on the Zambezi, at the border quad with Zambia and Botswana.",
  },
];

/** Every other town & growth point in the gazetteer (86 places). */
export const ZW_TOWNS: CityInfo[] = [
  { name: "Marondera", lat: -18.1853, lng: 31.5467, province: "Mashonaland East" },
  { name: "Kwekwe", lat: -18.9281, lng: 29.8149, province: "Midlands" },
  { name: "Kadoma", lat: -18.34, lng: 29.9, province: "Mashonaland West" },
  { name: "Chinhoyi", lat: -17.3667, lng: 30.2, province: "Mashonaland West" },
  { name: "Bindura", lat: -17.3019, lng: 31.3306, province: "Mashonaland Central" },
  { name: "Chegutu", lat: -18.1333, lng: 30.1333, province: "Mashonaland West" },
  { name: "Gokwe", lat: -18.2167, lng: 28.9333, province: "Midlands" },
  { name: "Zvishavane", lat: -20.3167, lng: 30.0333, province: "Midlands" },
  { name: "Chiredzi", lat: -21.0389, lng: 31.6778, province: "Masvingo Province" },
  { name: "Beitbridge", lat: -22.2167, lng: 30, province: "Matabeleland South" },
  { name: "Hwange", lat: -18.3667, lng: 26.5, province: "Matabeleland North" },
  { name: "Kariba", lat: -16.5167, lng: 28.8667, province: "Mashonaland West" },
  { name: "Nyanga", lat: -18.2143, lng: 32.7559, province: "Manicaland" },
  { name: "Juliasdale", lat: -18.3708, lng: 32.68, province: "Manicaland" },
  { name: "Troutbeck", lat: -18.1667, lng: 32.6833, province: "Manicaland" },
  { name: "Karoi", lat: -16.8167, lng: 29.6833, province: "Mashonaland West" },
  { name: "Murewa", lat: -17.649, lng: 31.784, province: "Mashonaland East" },
  { name: "Mutoko", lat: -17.4167, lng: 32.2333, province: "Mashonaland East" },
  { name: "Plumtree", lat: -20.4667, lng: 27.8167, province: "Matabeleland South" },
  { name: "Redcliff", lat: -19.0333, lng: 29.7833, province: "Midlands" },
  { name: "Chivhu", lat: -19.2, lng: 30.9, province: "Mashonaland East" },
  { name: "Rusape", lat: -18.5167, lng: 32.1167, province: "Manicaland" },
  { name: "Chipinge", lat: -20.2167, lng: 32.5833, province: "Manicaland" },
  { name: "Chimanimani", lat: -19.7833, lng: 32.8667, province: "Manicaland" },
  { name: "Penhalonga", lat: -18.8833, lng: 32.65, province: "Manicaland" },
  { name: "Mazowe", lat: -17.5, lng: 30.9667, province: "Mashonaland Central" },
  { name: "Banket", lat: -17.4333, lng: 30.3667, province: "Mashonaland West" },
  { name: "Glendale", lat: -17.6, lng: 31.1, province: "Mashonaland Central" },
  { name: "Shurugwi", lat: -19.6667, lng: 30, province: "Midlands" },
  { name: "Triangle", lat: -21.0167, lng: 31.4333, province: "Masvingo Province" },
  { name: "Birchenough Bridge", lat: -19.9631, lng: 32.3431, province: "Manicaland" },
  { name: "Chirundu", lat: -16.0333, lng: 28.85, province: "Mashonaland West" },
  { name: "Gwanda", lat: -20.9333, lng: 29.0167, province: "Matabeleland South" },
  { name: "Lupane", lat: -18.9333, lng: 27.7667, province: "Matabeleland North" },
  { name: "Tsholotsho", lat: -19.7, lng: 27.7333, province: "Matabeleland North" },
  { name: "Mvurwi", lat: -17.0167, lng: 30.85, province: "Mashonaland Central" },
  { name: "Mount Darwin", lat: -16.765, lng: 31.575, province: "Mashonaland Central" },
  { name: "Shamva", lat: -17.3167, lng: 31.55, province: "Mashonaland Central" },
  { name: "Guruve", lat: -16.65, lng: 30.7, province: "Mashonaland Central" },
  { name: "Rushinga", lat: -16.83, lng: 31.57, province: "Mashonaland Central" },
  { name: "Muzarabani", lat: -16.08, lng: 31.08, province: "Mashonaland Central" },
  { name: "Mushumbi", lat: -16.32, lng: 30.61, province: "Mashonaland Central" },
  { name: "Wedza", lat: -18.6167, lng: 31.5667, province: "Mashonaland East" },
  { name: "Kotwa", lat: -17.3, lng: 32.35, province: "Mashonaland East" },
  { name: "Uzumba", lat: -17.42, lng: 31.87, province: "Mashonaland East" },
  { name: "Goromonzi", lat: -17.855, lng: 31.3758, province: "Mashonaland East" },
  { name: "Murambinda", lat: -19.65, lng: 31.73, province: "Manicaland" },
  { name: "Magunje", lat: -16.8395, lng: 29.4253, province: "Mashonaland West" },
  { name: "Murombedzi", lat: -17.7, lng: 30.2, province: "Mashonaland West" },
  { name: "Sanyati", lat: -17.95, lng: 29.3075, province: "Mashonaland West" },
  { name: "Selous", lat: -18.0833, lng: 30.45, province: "Mashonaland West" },
  { name: "Mutorashanga", lat: -17.15, lng: 30.6667, province: "Mashonaland West" },
  { name: "Alaska", lat: -17.43, lng: 30.27, province: "Mashonaland West" },
  { name: "Battlefields", lat: -18.6, lng: 29.8333, province: "Mashonaland West" },
  { name: "Mvuma", lat: -19.2833, lng: 30.5333, province: "Midlands" },
  { name: "Mberengwa", lat: -20.4833, lng: 29.9167, province: "Midlands" },
  { name: "Maranda", lat: -21.15, lng: 30.3181, province: "Midlands" },
  { name: "Mataga", lat: -20.62, lng: 29.72, province: "Midlands" },
  { name: "Chivi", lat: -20.03, lng: 31.07, province: "Masvingo Province" },
  { name: "Gutu", lat: -19.93, lng: 31.05, province: "Masvingo Province" },
  { name: "Neshuro", lat: -20.95, lng: 30.65, province: "Masvingo Province" },
  { name: "Jerera", lat: -20.29, lng: 31.36, province: "Masvingo Province" },
  { name: "Bikita", lat: -20.15, lng: 31.77, province: "Masvingo Province" },
  { name: "Filabusi", lat: -20.5294, lng: 29.2867, province: "Matabeleland South" },
  { name: "Kezi", lat: -20.9167, lng: 28.4667, province: "Matabeleland South" },
  { name: "Maphisa", lat: -21.05, lng: 28.4333, province: "Matabeleland South" },
  { name: "Esigodini", lat: -20.2925, lng: 28.9381, province: "Matabeleland South" },
  { name: "Figtree", lat: -20.3681, lng: 28.3292, province: "Matabeleland South" },
  { name: "Binga", lat: -17.63, lng: 27.34, province: "Matabeleland North" },
  { name: "Nkayi", lat: -19.03, lng: 28.16, province: "Matabeleland North" },
  { name: "Kamativi", lat: -18.5333, lng: 27.1167, province: "Matabeleland North" },
  { name: "Dete", lat: -18.62, lng: 26.87, province: "Matabeleland North" },
  { name: "Nyamandlovu", lat: -19.97, lng: 28.53, province: "Matabeleland North" },
  { name: "Headlands", lat: -18.2833, lng: 32.05, province: "Manicaland" },
  { name: "Nyazura", lat: -18.7167, lng: 32.1667, province: "Manicaland" },
  { name: "Odzi", lat: -18.9667, lng: 32.3667, province: "Manicaland" },
  { name: "Watsomba", lat: -18.6833, lng: 32.6333, province: "Manicaland" },
  { name: "Hauna", lat: -18.53, lng: 32.97, province: "Manicaland" },
  { name: "Checheche", lat: -20.73, lng: 32.63, province: "Manicaland" },
  { name: "Chisumbanje", lat: -20.81, lng: 32.41, province: "Manicaland" },
];

/** All 10 provinces in canonical display order. */
export const PROVINCES: string[] = ["Harare Province", "Bulawayo Province", "Manicaland", "Mashonaland Central", "Mashonaland East", "Mashonaland West", "Masvingo Province", "Matabeleland North", "Matabeleland South", "Midlands"];

/** All selectable places: 6 cities first, then towns. */
export const ALL_PLACES: CityInfo[] = [...ZIMBABWE_CITIES, ...ZW_TOWNS];

/** Case-insensitive place lookup (cities + all towns); null for unknown. */
export function cityInfo(name: string): CityInfo | null {
  const n = (name || "").trim().toLowerCase();
  if (!n) return null;
  return ALL_PLACES.find((c) => c.name.toLowerCase() === n) ?? null;
}

/** Places grouped by province for grouped <select>s. */
export function placesByProvince(): { province: string; places: CityInfo[] }[] {
  return PROVINCES.map((province) => ({
    province,
    places: ALL_PLACES.filter((c) => c.province === province),
  })).filter((g) => g.places.length > 0);
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in kilometres between two coordinates. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371; // km — mean Earth radius
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight-line distance in km between two known places (by name). */
export function cityDistanceKm(from: string, to: string): number | null {
  const a = cityInfo(from);
  const b = cityInfo(to);
  if (!a || !b) return null;
  return haversineKm(a, b);
}

/** The closest known place (city or town) to any coordinate. Always resolves. */
export function nearestCity(lat: number, lng: number): CityInfo {
  return ALL_PLACES.reduce((best, c) =>
    haversineKm({ lat, lng }, c) < haversineKm({ lat, lng }, best) ? c : best,
  );
}
