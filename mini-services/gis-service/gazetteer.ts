// gazetteer.ts — curated Zimbabwe place dataset + geo helpers.
//
// Coverage: the 6 marketplace cities, Harare/Bulawayo suburbs, major towns,
// ALL 64 administrative districts (Wikipedia ‘Districts of Zimbabwe’
// canonical province lists), 45+ small towns & growth points (district HQs
// and service centres, geocoded from Wikipedia coordinate data), the 3
// international airports and well-known landmarks. Coordinates are
// city-center approximations — good enough for search, reverse lookup,
// routing snaps and map labels. No proprietary map APIs.
//
// display_name is composed as "Name, Parent, Zimbabwe" (Nominatim convention).

export type PlaceType = "city" | "suburb" | "town" | "district" | "airport" | "landmark" | "place";

/** [minLat, minLng, maxLat, maxLng] */
export type BBox = [number, number, number, number];

export interface GazetteerEntry {
  id: string;
  name: string;
  displayName: string;
  type: PlaceType;
  lat: number;
  lng: number;
  /** 0..1 — Nominatim-style ranking weight. */
  importance: number;
  /** id of the parent place (a gazetteer id) or null. */
  parent: string | null;
  /** Province (used for reverse-geocode `address.state`). */
  province: string;
  /** Population class label for map labels, e.g. "1.6M". */
  populationClass?: string;
  /** Map label rank: 1 city · 2 major town · 3 small town · 4 district · 0 other. */
  rank: number;
  bbox: BBox;
  /** Stable numeric id (1-based) — used as place_id / osm_id. */
  placeId: number;
}

interface RawEntry {
  id: string;
  name: string;
  type: PlaceType;
  lat: number;
  lng: number;
  importance: number;
  parent: string | null;
  province: string;
  populationClass?: string;
  bbox?: BBox;
}

/** Great-circle distance in km between two {lat,lng} points. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Derive a small bbox around a place from its type (when none is set). */
function deriveBBox(e: RawEntry): BBox {
  const spans: Record<PlaceType, [number, number]> = {
    city: [0.15, 0.18],
    town: [0.06, 0.07],
    district: [0.2, 0.22],
    suburb: [0.02, 0.025],
    airport: [0.03, 0.03],
    landmark: [0.05, 0.05],
    place: [0.05, 0.05],
  };
  const [dLat, dLng] = spans[e.type] ?? [0.05, 0.05];
  return [e.lat - dLat, e.lng - dLng, e.lat + dLat, e.lng + dLng];
}

/** Map label rank from type + population class (drives tile zoom rules). */
function deriveRank(e: RawEntry): number {
  if (e.type === "city") return 1;
  if (e.type === "district") return 4;
  if (e.type !== "town") return 0;
  const m = /^([\d.]+)\s*([km])$/i.exec((e.populationClass ?? "").trim());
  if (!m) return 3;
  const n = Number(m[1]);
  const popK = m[2].toLowerCase() === "m" ? n * 1000 : n;
  return popK >= 20 ? 2 : 3;
}

const RAW: RawEntry[] = [
  // ── The 6 marketplace cities (coords match src/components/tengasell/map/cities.ts) ──
  { id: "harare", name: "Harare", type: "city", lat: -17.8292, lng: 31.0522, importance: 1.0, parent: null, province: "Harare Province", populationClass: "1.6M" },
  { id: "bulawayo", name: "Bulawayo", type: "city", lat: -20.15, lng: 28.5873, importance: 0.92, parent: null, province: "Bulawayo Province", populationClass: "700k" },
  { id: "mutare", name: "Mutare", type: "city", lat: -18.9707, lng: 32.5707, importance: 0.8, parent: null, province: "Manicaland", populationClass: "270k" },
  { id: "gweru", name: "Gweru", type: "city", lat: -19.45, lng: 29.8167, importance: 0.75, parent: null, province: "Midlands", populationClass: "160k" },
  { id: "masvingo", name: "Masvingo", type: "city", lat: -20.0744, lng: 30.889, importance: 0.75, parent: null, province: "Masvingo Province", populationClass: "110k" },
  { id: "victoria-falls", name: "Victoria Falls", type: "city", lat: -17.9316, lng: 25.8318, importance: 0.8, parent: null, province: "Matabeleland North", populationClass: "35k" },

  // ── Harare suburbs & satellite areas ──
  { id: "avondale", name: "Avondale", type: "suburb", lat: -17.832, lng: 31.02, importance: 0.45, parent: "harare", province: "Harare Province" },
  { id: "borrowdale", name: "Borrowdale", type: "suburb", lat: -17.735, lng: 31.065, importance: 0.45, parent: "harare", province: "Harare Province" },
  { id: "mount-pleasant", name: "Mount Pleasant", type: "suburb", lat: -17.762, lng: 31.052, importance: 0.42, parent: "harare", province: "Harare Province" },
  { id: "highlands", name: "Highlands", type: "suburb", lat: -17.807, lng: 31.085, importance: 0.42, parent: "harare", province: "Harare Province" },
  { id: "greendale", name: "Greendale", type: "suburb", lat: -17.825, lng: 31.104, importance: 0.38, parent: "harare", province: "Harare Province" },
  { id: "belvedere", name: "Belvedere", type: "suburb", lat: -17.838, lng: 31.034, importance: 0.38, parent: "harare", province: "Harare Province" },
  { id: "marlborough", name: "Marlborough", type: "suburb", lat: -17.794, lng: 31.014, importance: 0.36, parent: "harare", province: "Harare Province" },
  { id: "waterfalls", name: "Waterfalls", type: "suburb", lat: -17.887, lng: 31.057, importance: 0.36, parent: "harare", province: "Harare Province" },
  { id: "highfield", name: "Highfield", type: "suburb", lat: -17.888, lng: 31.017, importance: 0.35, parent: "harare", province: "Harare Province" },
  { id: "mbare", name: "Mbare", type: "suburb", lat: -17.863, lng: 31.033, importance: 0.38, parent: "harare", province: "Harare Province" },
  { id: "epworth", name: "Epworth", type: "suburb", lat: -17.89, lng: 31.147, importance: 0.34, parent: "harare", province: "Harare Province" },
  { id: "chitungwiza", name: "Chitungwiza", type: "suburb", lat: -18.012, lng: 31.075, importance: 0.4, parent: "harare", province: "Harare Province" },
  { id: "norton", name: "Norton", type: "suburb", lat: -17.883, lng: 30.705, importance: 0.36, parent: "harare", province: "Mashonaland West" },
  { id: "ruwa", name: "Ruwa", type: "suburb", lat: -17.889, lng: 31.244, importance: 0.34, parent: "harare", province: "Harare Province" },
  { id: "hatfield", name: "Hatfield", type: "suburb", lat: -17.906, lng: 31.053, importance: 0.3, parent: "harare", province: "Harare Province" },
  { id: "mabelreign", name: "Mabelreign", type: "suburb", lat: -17.808, lng: 31.014, importance: 0.3, parent: "harare", province: "Harare Province" },
  { id: "dzivarasekwa", name: "Dzivarasekwa", type: "suburb", lat: -17.874, lng: 30.977, importance: 0.28, parent: "harare", province: "Harare Province" },
  { id: "budiriro", name: "Budiriro", type: "suburb", lat: -17.894, lng: 31.003, importance: 0.28, parent: "harare", province: "Harare Province" },

  // ── Bulawayo suburbs ──
  { id: "bulawayo-city-centre", name: "Bulawayo City Centre", type: "suburb", lat: -20.15, lng: 28.583, importance: 0.4, parent: "bulawayo", province: "Bulawayo Province" },
  { id: "nkulumane", name: "Nkulumane", type: "suburb", lat: -20.155, lng: 28.582, importance: 0.34, parent: "bulawayo", province: "Bulawayo Province" },
  { id: "luveve", name: "Luveve", type: "suburb", lat: -20.132, lng: 28.56, importance: 0.3, parent: "bulawayo", province: "Bulawayo Province" },
  { id: "kumalo", name: "Kumalo", type: "suburb", lat: -20.172, lng: 28.583, importance: 0.3, parent: "bulawayo", province: "Bulawayo Province" },
  { id: "bellevue", name: "Bellevue", type: "suburb", lat: -20.202, lng: 28.572, importance: 0.28, parent: "bulawayo", province: "Bulawayo Province" },
  { id: "cowdray-park", name: "Cowdray Park", type: "suburb", lat: -20.132, lng: 28.556, importance: 0.28, parent: "bulawayo", province: "Bulawayo Province" },

  // ── Major towns ──
  { id: "marondera", name: "Marondera", type: "town", lat: -18.1853, lng: 31.5467, importance: 0.58, parent: null, province: "Mashonaland East", populationClass: "60k" },
  { id: "kwekwe", name: "Kwekwe", type: "town", lat: -18.9281, lng: 29.8149, importance: 0.6, parent: null, province: "Midlands", populationClass: "100k" },
  { id: "kadoma", name: "Kadoma", type: "town", lat: -18.34, lng: 29.9, importance: 0.55, parent: null, province: "Mashonaland West", populationClass: "80k" },
  { id: "chinhoyi", name: "Chinhoyi", type: "town", lat: -17.3667, lng: 30.2, importance: 0.58, parent: null, province: "Mashonaland West", populationClass: "90k" },
  { id: "bindura", name: "Bindura", type: "town", lat: -17.3019, lng: 31.3306, importance: 0.55, parent: null, province: "Mashonaland Central", populationClass: "46k" },
  { id: "chegutu", name: "Chegutu", type: "town", lat: -18.1333, lng: 30.1333, importance: 0.5, parent: null, province: "Mashonaland West", populationClass: "50k" },
  { id: "gokwe", name: "Gokwe", type: "town", lat: -18.2167, lng: 28.9333, importance: 0.48, parent: null, province: "Midlands", populationClass: "25k" },
  { id: "zvishavane", name: "Zvishavane", type: "town", lat: -20.3167, lng: 30.0333, importance: 0.48, parent: null, province: "Midlands", populationClass: "45k" },
  { id: "chiredzi", name: "Chiredzi", type: "town", lat: -21.0389, lng: 31.6778, importance: 0.46, parent: null, province: "Masvingo Province", populationClass: "30k" },
  { id: "beitbridge", name: "Beitbridge", type: "town", lat: -22.2167, lng: 30.0, importance: 0.52, parent: null, province: "Matabeleland South", populationClass: "45k" },
  { id: "hwange", name: "Hwange", type: "town", lat: -18.3667, lng: 26.5, importance: 0.5, parent: null, province: "Matabeleland North", populationClass: "40k" },
  { id: "kariba", name: "Kariba", type: "town", lat: -16.5167, lng: 28.8667, importance: 0.52, parent: null, province: "Mashonaland West", populationClass: "25k" },
  { id: "nyanga", name: "Nyanga", type: "town", lat: -18.2143, lng: 32.7559, importance: 0.55, parent: null, province: "Manicaland", populationClass: "5k" },
  { id: "juliasdale", name: "Juliasdale", type: "town", lat: -18.3708, lng: 32.68, importance: 0.42, parent: null, province: "Manicaland", populationClass: "2k" },
  { id: "troutbeck", name: "Troutbeck", type: "town", lat: -18.1667, lng: 32.6833, importance: 0.42, parent: null, province: "Manicaland", populationClass: "1k" },
  { id: "karoi", name: "Karoi", type: "town", lat: -16.8167, lng: 29.6833, importance: 0.44, parent: null, province: "Mashonaland West", populationClass: "25k" },
  { id: "murewa", name: "Murewa", type: "town", lat: -17.649, lng: 31.784, importance: 0.4, parent: null, province: "Mashonaland East", populationClass: "20k" },
  { id: "mutoko", name: "Mutoko", type: "town", lat: -17.4167, lng: 32.2333, importance: 0.38, parent: null, province: "Mashonaland East", populationClass: "15k" },
  { id: "plumtree", name: "Plumtree", type: "town", lat: -20.4667, lng: 27.8167, importance: 0.38, parent: null, province: "Matabeleland South", populationClass: "12k" },
  { id: "redcliff", name: "Redcliff", type: "town", lat: -19.0333, lng: 29.7833, importance: 0.36, parent: null, province: "Midlands", populationClass: "35k" },
  { id: "chivhu", name: "Chivhu", type: "town", lat: -19.2, lng: 30.9, importance: 0.4, parent: null, province: "Mashonaland East", populationClass: "12k" },
  { id: "rusape", name: "Rusape", type: "town", lat: -18.5167, lng: 32.1167, importance: 0.45, parent: null, province: "Manicaland", populationClass: "30k" },
  { id: "chipinge", name: "Chipinge", type: "town", lat: -20.2167, lng: 32.5833, importance: 0.4, parent: null, province: "Manicaland", populationClass: "25k" },
  { id: "chimanimani", name: "Chimanimani", type: "town", lat: -19.7833, lng: 32.8667, importance: 0.42, parent: null, province: "Manicaland", populationClass: "8k" },
  { id: "penhalonga", name: "Penhalonga", type: "town", lat: -18.8833, lng: 32.65, importance: 0.36, parent: null, province: "Manicaland", populationClass: "10k" },
  { id: "mazowe", name: "Mazowe", type: "town", lat: -17.5, lng: 30.9667, importance: 0.38, parent: null, province: "Mashonaland Central", populationClass: "15k" },
  { id: "banket", name: "Banket", type: "town", lat: -17.4333, lng: 30.3667, importance: 0.34, parent: null, province: "Mashonaland West", populationClass: "15k" },
  { id: "glendale", name: "Glendale", type: "town", lat: -17.6, lng: 31.1, importance: 0.34, parent: null, province: "Mashonaland Central", populationClass: "12k" },
  { id: "shurugwi", name: "Shurugwi", type: "town", lat: -19.6667, lng: 30.0, importance: 0.36, parent: null, province: "Midlands", populationClass: "20k" },
  { id: "triangle", name: "Triangle", type: "town", lat: -21.0167, lng: 31.4333, importance: 0.32, parent: null, province: "Masvingo Province", populationClass: "15k" },
  { id: "birchenough-bridge", name: "Birchenough Bridge", type: "town", lat: -19.9631, lng: 32.3431, importance: 0.34, parent: null, province: "Manicaland", populationClass: "2k" },
  { id: "chirundu", name: "Chirundu", type: "town", lat: -16.0333, lng: 28.85, importance: 0.4, parent: null, province: "Mashonaland West", populationClass: "5k" },
  { id: "gwanda", name: "Gwanda", type: "town", lat: -20.9333, lng: 29.0167, importance: 0.42, parent: null, province: "Matabeleland South", populationClass: "20k" },
  { id: "lupane", name: "Lupane", type: "town", lat: -18.9333, lng: 27.7667, importance: 0.36, parent: null, province: "Matabeleland North", populationClass: "10k" },
  { id: "tsholotsho", name: "Tsholotsho", type: "town", lat: -19.7, lng: 27.7333, importance: 0.32, parent: null, province: "Matabeleland North", populationClass: "10k" },

  // ── Airports ──
  { id: "robert-mugabe-intl", name: "Robert Gabriel Mugabe International Airport", type: "airport", lat: -17.9328, lng: 31.0978, importance: 0.55, parent: "harare", province: "Harare Province" },
  { id: "nkomo-intl", name: "Joshua Mqabuko Nkomo International Airport", type: "airport", lat: -20.0168, lng: 28.6185, importance: 0.48, parent: "bulawayo", province: "Bulawayo Province" },
  { id: "victoria-falls-airport", name: "Victoria Falls Airport", type: "airport", lat: -18.0965, lng: 25.8393, importance: 0.48, parent: "victoria-falls", province: "Matabeleland North" },

  // ── Landmarks ──
  { id: "national-sports-stadium", name: "National Sports Stadium", type: "landmark", lat: -17.8278, lng: 31.0494, importance: 0.45, parent: "harare", province: "Harare Province" },
  { id: "lake-kariba", name: "Lake Kariba", type: "landmark", lat: -16.5, lng: 28.3, importance: 0.55, parent: null, province: "", bbox: [-16.95, 27.6, -16.05, 28.9] },
  { id: "great-zimbabwe", name: "Great Zimbabwe", type: "landmark", lat: -20.2673, lng: 30.9331, importance: 0.6, parent: "masvingo", province: "Masvingo Province" },
  { id: "matobo-hills", name: "Matobo Hills", type: "landmark", lat: -20.5, lng: 28.9, importance: 0.5, parent: null, province: "Matabeleland South", bbox: [-20.75, 28.6, -20.25, 29.2] },
  { id: "eastern-highlands", name: "Eastern Highlands", type: "landmark", lat: -18.9, lng: 32.7, importance: 0.5, parent: null, province: "Manicaland", bbox: [-19.3, 32.2, -18.2, 33.05] },
  { id: "lake-chivero", name: "Lake Chivero", type: "landmark", lat: -17.8736, lng: 30.8289, importance: 0.4, parent: "harare", province: "Mashonaland West", bbox: [-17.92, 30.75, -17.82, 30.91] },
  { id: "victoria-falls-falls", name: "Victoria Falls (Waterfall)", type: "landmark", lat: -17.9246, lng: 25.8572, importance: 0.75, parent: "victoria-falls", province: "Matabeleland North" },
  { id: "africa-unity-square", name: "Africa Unity Square", type: "landmark", lat: -17.8317, lng: 31.0444, importance: 0.36, parent: "harare", province: "Harare Province" },
  { id: "mbare-musika", name: "Mbare Musika Market", type: "landmark", lat: -17.8695, lng: 31.0355, importance: 0.35, parent: "harare", province: "Harare Province" },
  { id: "sam-levys-village", name: "Sam Levy's Village", type: "landmark", lat: -17.7395, lng: 31.0765, importance: 0.38, parent: "borrowdale", province: "Harare Province" },
  { id: "chinhoyi-caves", name: "Chinhoyi Caves", type: "landmark", lat: -17.346, lng: 30.188, importance: 0.45, parent: "chinhoyi", province: "Mashonaland West" },
  { id: "khami-ruins", name: "Khami Ruins", type: "landmark", lat: -20.4167, lng: 28.5, importance: 0.4, parent: "bulawayo", province: "Matabeleland North" },

  // ── Administrative districts — all 64, per Wikipedia
  // ‘Districts of Zimbabwe’ canonical province lists ──
  { id: "bulawayo-district", name: "Bulawayo District", type: "district", lat: -20.15, lng: 28.5873, importance: 0.15, parent: null, province: "Bulawayo Province" },
  { id: "harare-district", name: "Harare District", type: "district", lat: -17.8292, lng: 31.0522, importance: 0.15, parent: null, province: "Harare Province" },
  { id: "chitungwiza-district", name: "Chitungwiza District", type: "district", lat: -18.012, lng: 31.075, importance: 0.15, parent: null, province: "Harare Province" },
  { id: "epworth-district", name: "Epworth District", type: "district", lat: -17.89, lng: 31.147, importance: 0.15, parent: null, province: "Harare Province" },
  { id: "buhera-district", name: "Buhera District", type: "district", lat: -19.65, lng: 31.73, importance: 0.15, parent: null, province: "Manicaland" },
  { id: "chimanimani-district", name: "Chimanimani District", type: "district", lat: -19.7833, lng: 32.8667, importance: 0.15, parent: null, province: "Manicaland" },
  { id: "chipinge-district", name: "Chipinge District", type: "district", lat: -20.2167, lng: 32.5833, importance: 0.15, parent: null, province: "Manicaland" },
  { id: "makoni-district", name: "Makoni District", type: "district", lat: -18.5167, lng: 32.1167, importance: 0.15, parent: null, province: "Manicaland" },
  { id: "mutare-district", name: "Mutare District", type: "district", lat: -18.9707, lng: 32.5707, importance: 0.15, parent: null, province: "Manicaland" },
  { id: "mutasa-district", name: "Mutasa District", type: "district", lat: -18.6833, lng: 32.6333, importance: 0.15, parent: null, province: "Manicaland" },
  { id: "nyanga-district", name: "Nyanga District", type: "district", lat: -18.2143, lng: 32.7559, importance: 0.15, parent: null, province: "Manicaland" },
  { id: "bindura-district", name: "Bindura District", type: "district", lat: -17.3019, lng: 31.3306, importance: 0.15, parent: null, province: "Mashonaland Central" },
  { id: "guruve-district", name: "Guruve District", type: "district", lat: -16.65, lng: 30.7, importance: 0.15, parent: null, province: "Mashonaland Central" },
  { id: "mazowe-district", name: "Mazowe District", type: "district", lat: -17.5, lng: 30.9667, importance: 0.15, parent: null, province: "Mashonaland Central" },
  { id: "mbire-district", name: "Mbire District", type: "district", lat: -16.32, lng: 30.61, importance: 0.15, parent: null, province: "Mashonaland Central" },
  { id: "mount-darwin-district", name: "Mount Darwin District", type: "district", lat: -16.765, lng: 31.575, importance: 0.15, parent: null, province: "Mashonaland Central" },
  { id: "muzarabani-district", name: "Muzarabani District", type: "district", lat: -16.08, lng: 31.08, importance: 0.15, parent: null, province: "Mashonaland Central" },
  { id: "rushinga-district", name: "Rushinga District", type: "district", lat: -16.83, lng: 31.57, importance: 0.15, parent: null, province: "Mashonaland Central" },
  { id: "shamva-district", name: "Shamva District", type: "district", lat: -17.3167, lng: 31.55, importance: 0.15, parent: null, province: "Mashonaland Central" },
  { id: "chikomba-district", name: "Chikomba District", type: "district", lat: -19.2, lng: 30.9, importance: 0.15, parent: null, province: "Mashonaland East" },
  { id: "goromonzi-district", name: "Goromonzi District", type: "district", lat: -17.855, lng: 31.3758, importance: 0.15, parent: null, province: "Mashonaland East" },
  { id: "marondera-district", name: "Marondera District", type: "district", lat: -18.1853, lng: 31.5467, importance: 0.15, parent: null, province: "Mashonaland East" },
  { id: "mudzi-district", name: "Mudzi District", type: "district", lat: -17.3, lng: 32.35, importance: 0.15, parent: null, province: "Mashonaland East" },
  { id: "murehwa-district", name: "Murehwa District", type: "district", lat: -17.649, lng: 31.784, importance: 0.15, parent: null, province: "Mashonaland East" },
  { id: "mutoko-district", name: "Mutoko District", type: "district", lat: -17.4167, lng: 32.2333, importance: 0.15, parent: null, province: "Mashonaland East" },
  { id: "seke-district", name: "Seke District", type: "district", lat: -18.2333, lng: 30.95, importance: 0.15, parent: null, province: "Mashonaland East" },
  { id: "ump-district", name: "Uzumba-Maramba-Pfungwe District", type: "district", lat: -17.42, lng: 31.87, importance: 0.15, parent: null, province: "Mashonaland East" },
  { id: "hwedza-district", name: "Wedza District", type: "district", lat: -18.6167, lng: 31.5667, importance: 0.15, parent: null, province: "Mashonaland East" },
  { id: "chegutu-district", name: "Chegutu District", type: "district", lat: -18.1333, lng: 30.1333, importance: 0.15, parent: null, province: "Mashonaland West" },
  { id: "hurungwe-district", name: "Hurungwe District", type: "district", lat: -16.8167, lng: 29.6833, importance: 0.15, parent: null, province: "Mashonaland West" },
  { id: "kariba-district", name: "Kariba District", type: "district", lat: -16.5167, lng: 28.8667, importance: 0.15, parent: null, province: "Mashonaland West" },
  { id: "makonde-district", name: "Makonde District", type: "district", lat: -17.3667, lng: 30.2, importance: 0.15, parent: null, province: "Mashonaland West" },
  { id: "mhondoro-ngezi-district", name: "Mhondoro-Ngezi District", type: "district", lat: -18.5, lng: 30.45, importance: 0.15, parent: null, province: "Mashonaland West" },
  { id: "sanyati-district", name: "Sanyati District", type: "district", lat: -17.95, lng: 29.3075, importance: 0.15, parent: null, province: "Mashonaland West" },
  { id: "zvimba-district", name: "Zvimba District", type: "district", lat: -17.7, lng: 30.2, importance: 0.15, parent: null, province: "Mashonaland West" },
  { id: "bikita-district", name: "Bikita District", type: "district", lat: -20.15, lng: 31.77, importance: 0.15, parent: null, province: "Masvingo Province" },
  { id: "chiredzi-district", name: "Chiredzi District", type: "district", lat: -21.0389, lng: 31.6778, importance: 0.15, parent: null, province: "Masvingo Province" },
  { id: "chivi-district", name: "Chivi District", type: "district", lat: -20.03, lng: 31.07, importance: 0.15, parent: null, province: "Masvingo Province" },
  { id: "gutu-district", name: "Gutu District", type: "district", lat: -19.93, lng: 31.05, importance: 0.15, parent: null, province: "Masvingo Province" },
  { id: "masvingo-district", name: "Masvingo District", type: "district", lat: -20.0744, lng: 30.889, importance: 0.15, parent: null, province: "Masvingo Province" },
  { id: "mwenezi-district", name: "Mwenezi District", type: "district", lat: -20.95, lng: 30.65, importance: 0.15, parent: null, province: "Masvingo Province" },
  { id: "zaka-district", name: "Zaka District", type: "district", lat: -20.29, lng: 31.36, importance: 0.15, parent: null, province: "Masvingo Province" },
  { id: "binga-district", name: "Binga District", type: "district", lat: -17.63, lng: 27.34, importance: 0.15, parent: null, province: "Matabeleland North" },
  { id: "bubi-district", name: "Bubi District", type: "district", lat: -19.7, lng: 28.45, importance: 0.15, parent: null, province: "Matabeleland North" },
  { id: "hwange-district", name: "Hwange District", type: "district", lat: -18.3667, lng: 26.5, importance: 0.15, parent: null, province: "Matabeleland North" },
  { id: "lupane-district", name: "Lupane District", type: "district", lat: -18.9333, lng: 27.7667, importance: 0.15, parent: null, province: "Matabeleland North" },
  { id: "nkayi-district", name: "Nkayi District", type: "district", lat: -19.03, lng: 28.16, importance: 0.15, parent: null, province: "Matabeleland North" },
  { id: "tsholotsho-district", name: "Tsholotsho District", type: "district", lat: -19.7, lng: 27.7333, importance: 0.15, parent: null, province: "Matabeleland North" },
  { id: "umguza-district", name: "Umguza District", type: "district", lat: -19.97, lng: 28.53, importance: 0.15, parent: null, province: "Matabeleland North" },
  { id: "beitbridge-district", name: "Beitbridge District", type: "district", lat: -22.2167, lng: 30.0, importance: 0.15, parent: null, province: "Matabeleland South" },
  { id: "bulilima-district", name: "Bulilima District", type: "district", lat: -20.55, lng: 27.95, importance: 0.15, parent: null, province: "Matabeleland South" },
  { id: "gwanda-district", name: "Gwanda District", type: "district", lat: -20.9333, lng: 29.0167, importance: 0.15, parent: null, province: "Matabeleland South" },
  { id: "insiza-district", name: "Insiza District", type: "district", lat: -20.5294, lng: 29.2867, importance: 0.15, parent: null, province: "Matabeleland South" },
  { id: "mangwe-district", name: "Mangwe District", type: "district", lat: -20.95, lng: 27.9833, importance: 0.15, parent: null, province: "Matabeleland South" },
  { id: "matobo-district", name: "Matobo District", type: "district", lat: -20.9167, lng: 28.4667, importance: 0.15, parent: null, province: "Matabeleland South" },
  { id: "umzingwane-district", name: "Umzingwane District", type: "district", lat: -20.2925, lng: 28.9381, importance: 0.15, parent: null, province: "Matabeleland South" },
  { id: "chirumhanzu-district", name: "Chirumhanzu District", type: "district", lat: -19.2833, lng: 30.5333, importance: 0.15, parent: null, province: "Midlands" },
  { id: "gokwe-north-district", name: "Gokwe North District", type: "district", lat: -18.2167, lng: 28.9333, importance: 0.15, parent: null, province: "Midlands" },
  { id: "gokwe-south-district", name: "Gokwe South District", type: "district", lat: -18.2167, lng: 28.9333, importance: 0.15, parent: null, province: "Midlands" },
  { id: "vungu-district", name: "Vungu District", type: "district", lat: -19.55, lng: 29.85, importance: 0.15, parent: null, province: "Midlands" },
  { id: "kwekwe-district", name: "Kwekwe District", type: "district", lat: -18.9281, lng: 29.8149, importance: 0.15, parent: null, province: "Midlands" },
  { id: "mberengwa-district", name: "Mberengwa District", type: "district", lat: -20.4833, lng: 29.9167, importance: 0.15, parent: null, province: "Midlands" },
  { id: "shurugwi-district", name: "Shurugwi District", type: "district", lat: -19.6667, lng: 30.0, importance: 0.15, parent: null, province: "Midlands" },
  { id: "zvishavane-district", name: "Zvishavane District", type: "district", lat: -20.3167, lng: 30.0333, importance: 0.15, parent: null, province: "Midlands" },

  // ── Small towns & growth points — district HQs and service
  //    centres, geocoded from Wikipedia coordinates ──
  { id: "mvurwi", name: "Mvurwi", type: "town", lat: -17.0167, lng: 30.85, importance: 0.34, parent: null, province: "Mashonaland Central", populationClass: "15k" },
  { id: "mount-darwin", name: "Mount Darwin", type: "town", lat: -16.765, lng: 31.575, importance: 0.36, parent: null, province: "Mashonaland Central", populationClass: "18k" },
  { id: "shamva", name: "Shamva", type: "town", lat: -17.3167, lng: 31.55, importance: 0.3, parent: null, province: "Mashonaland Central", populationClass: "10k" },
  { id: "guruve", name: "Guruve", type: "town", lat: -16.65, lng: 30.7, importance: 0.3, parent: null, province: "Mashonaland Central", populationClass: "10k" },
  { id: "rushinga", name: "Rushinga", type: "town", lat: -16.83, lng: 31.57, importance: 0.26, parent: null, province: "Mashonaland Central", populationClass: "5k" },
  { id: "muzarabani", name: "Muzarabani", type: "town", lat: -16.08, lng: 31.08, importance: 0.26, parent: null, province: "Mashonaland Central", populationClass: "8k" },
  { id: "mushumbi", name: "Mushumbi", type: "town", lat: -16.32, lng: 30.61, importance: 0.2, parent: null, province: "Mashonaland Central", populationClass: "2k" },
  { id: "wedza", name: "Wedza", type: "town", lat: -18.6167, lng: 31.5667, importance: 0.26, parent: null, province: "Mashonaland East", populationClass: "6k" },
  { id: "kotwa", name: "Kotwa", type: "town", lat: -17.3, lng: 32.35, importance: 0.22, parent: null, province: "Mashonaland East", populationClass: "4k" },
  { id: "uzumba", name: "Uzumba", type: "town", lat: -17.42, lng: 31.87, importance: 0.2, parent: null, province: "Mashonaland East", populationClass: "3k" },
  { id: "goromonzi-town", name: "Goromonzi", type: "town", lat: -17.855, lng: 31.3758, importance: 0.28, parent: null, province: "Mashonaland East", populationClass: "8k" },
  { id: "murambinda", name: "Murambinda", type: "town", lat: -19.65, lng: 31.73, importance: 0.24, parent: null, province: "Manicaland", populationClass: "5k" },
  { id: "magunje", name: "Magunje", type: "town", lat: -16.8395, lng: 29.4253, importance: 0.24, parent: null, province: "Mashonaland West", populationClass: "6k" },
  { id: "murombedzi", name: "Murombedzi", type: "town", lat: -17.7, lng: 30.2, importance: 0.22, parent: null, province: "Mashonaland West", populationClass: "4k" },
  { id: "sanyati", name: "Sanyati", type: "town", lat: -17.95, lng: 29.3075, importance: 0.22, parent: null, province: "Mashonaland West", populationClass: "5k" },
  { id: "selous", name: "Selous", type: "town", lat: -18.0833, lng: 30.45, importance: 0.2, parent: null, province: "Mashonaland West", populationClass: "3k" },
  { id: "mutorashanga", name: "Mutorashanga", type: "town", lat: -17.15, lng: 30.6667, importance: 0.18, parent: null, province: "Mashonaland West", populationClass: "2k" },
  { id: "alaska", name: "Alaska", type: "town", lat: -17.43, lng: 30.27, importance: 0.18, parent: null, province: "Mashonaland West", populationClass: "2k" },
  { id: "battlefields", name: "Battlefields", type: "town", lat: -18.6, lng: 29.8333, importance: 0.2, parent: null, province: "Mashonaland West", populationClass: "3k" },
  { id: "mvuma", name: "Mvuma", type: "town", lat: -19.2833, lng: 30.5333, importance: 0.3, parent: null, province: "Midlands", populationClass: "8k" },
  { id: "mberengwa", name: "Mberengwa", type: "town", lat: -20.4833, lng: 29.9167, importance: 0.3, parent: null, province: "Midlands", populationClass: "12k" },
  { id: "maranda", name: "Maranda", type: "town", lat: -21.15, lng: 30.3181, importance: 0.2, parent: null, province: "Midlands", populationClass: "3k" },
  { id: "mataga", name: "Mataga", type: "town", lat: -20.62, lng: 29.72, importance: 0.18, parent: null, province: "Midlands", populationClass: "2k" },
  { id: "chivi", name: "Chivi", type: "town", lat: -20.03, lng: 31.07, importance: 0.28, parent: null, province: "Masvingo Province", populationClass: "8k" },
  { id: "gutu", name: "Gutu", type: "town", lat: -19.93, lng: 31.05, importance: 0.32, parent: null, province: "Masvingo Province", populationClass: "15k" },
  { id: "neshuro", name: "Neshuro", type: "town", lat: -20.95, lng: 30.65, importance: 0.22, parent: null, province: "Masvingo Province", populationClass: "4k" },
  { id: "jerera", name: "Jerera", type: "town", lat: -20.29, lng: 31.36, importance: 0.24, parent: null, province: "Masvingo Province", populationClass: "5k" },
  { id: "bikita", name: "Bikita", type: "town", lat: -20.15, lng: 31.77, importance: 0.24, parent: null, province: "Masvingo Province", populationClass: "5k" },
  { id: "filabusi", name: "Filabusi", type: "town", lat: -20.5294, lng: 29.2867, importance: 0.26, parent: null, province: "Matabeleland South", populationClass: "5k" },
  { id: "kezi", name: "Kezi", type: "town", lat: -20.9167, lng: 28.4667, importance: 0.24, parent: null, province: "Matabeleland South", populationClass: "5k" },
  { id: "maphisa", name: "Maphisa", type: "town", lat: -21.05, lng: 28.4333, importance: 0.22, parent: null, province: "Matabeleland South", populationClass: "4k" },
  { id: "esigodini", name: "Esigodini", type: "town", lat: -20.2925, lng: 28.9381, importance: 0.28, parent: null, province: "Matabeleland South", populationClass: "8k" },
  { id: "figtree", name: "Figtree", type: "town", lat: -20.3681, lng: 28.3292, importance: 0.2, parent: null, province: "Matabeleland South", populationClass: "2k" },
  { id: "binga", name: "Binga", type: "town", lat: -17.63, lng: 27.34, importance: 0.26, parent: null, province: "Matabeleland North", populationClass: "6k" },
  { id: "nkayi", name: "Nkayi", type: "town", lat: -19.03, lng: 28.16, importance: 0.26, parent: null, province: "Matabeleland North", populationClass: "8k" },
  { id: "kamativi", name: "Kamativi", type: "town", lat: -18.5333, lng: 27.1167, importance: 0.18, parent: null, province: "Matabeleland North", populationClass: "2k" },
  { id: "dete", name: "Dete", type: "town", lat: -18.62, lng: 26.87, importance: 0.22, parent: null, province: "Matabeleland North", populationClass: "4k" },
  { id: "nyamandlovu", name: "Nyamandlovu", type: "town", lat: -19.97, lng: 28.53, importance: 0.2, parent: null, province: "Matabeleland North", populationClass: "3k" },
  { id: "headlands", name: "Headlands", type: "town", lat: -18.2833, lng: 32.05, importance: 0.28, parent: null, province: "Manicaland", populationClass: "8k" },
  { id: "nyazura", name: "Nyazura", type: "town", lat: -18.7167, lng: 32.1667, importance: 0.24, parent: null, province: "Manicaland", populationClass: "5k" },
  { id: "odzi", name: "Odzi", type: "town", lat: -18.9667, lng: 32.3667, importance: 0.24, parent: null, province: "Manicaland", populationClass: "6k" },
  { id: "watsomba", name: "Watsomba", type: "town", lat: -18.6833, lng: 32.6333, importance: 0.22, parent: null, province: "Manicaland", populationClass: "4k" },
  { id: "hauna", name: "Hauna", type: "town", lat: -18.53, lng: 32.97, importance: 0.24, parent: null, province: "Manicaland", populationClass: "6k" },
  { id: "checheche", name: "Checheche", type: "town", lat: -20.73, lng: 32.63, importance: 0.22, parent: null, province: "Manicaland", populationClass: "5k" },
  { id: "chisumbanje", name: "Chisumbanje", type: "town", lat: -20.81, lng: 32.41, importance: 0.2, parent: null, province: "Manicaland", populationClass: "4k" },
];

const byIdMap = new Map<string, GazetteerEntry>();

// Single-pass init: every `parent` id appears earlier in RAW than its children,
// so parent names are already resolvable when a child is composed.
export const GAZETTEER: GazetteerEntry[] = [];
RAW.forEach((raw, index) => {
  const parent = raw.parent ? byIdMap.get(raw.parent) : undefined;
  const displayName = parent
    ? `${raw.name}, ${parent.name}, Zimbabwe`
    : `${raw.name}, Zimbabwe`;
  const entry: GazetteerEntry = {
    ...raw,
    displayName,
    bbox: raw.bbox ?? deriveBBox(raw),
    rank: deriveRank(raw),
    placeId: index + 1,
  };
  GAZETTEER.push(entry);
  byIdMap.set(entry.id, entry);
});

/** Lookup by gazetteer id. */
export function byId(id: string): GazetteerEntry | null {
  return byIdMap.get(id) ?? null;
}

/** Lookup by stable numeric place id (used as osm_id). */
export function byPlaceId(placeId: number): GazetteerEntry | null {
  return GAZETTEER[placeId - 1] ?? null;
}

/** Name of the parent entry, or null. */
export function parentName(entry: GazetteerEntry): string | null {
  return entry.parent ? byIdMap.get(entry.parent)?.name ?? null : null;
}

/** Parent chain names, immediate parent first (e.g. ["Borrowdale", "Harare"]). */
export function parentChain(entry: GazetteerEntry): string[] {
  const chain: string[] = [];
  let cur: GazetteerEntry | null = entry;
  let guard = 0;
  while (cur?.parent && guard++ < 4) {
    const parent = byIdMap.get(cur.parent) ?? null;
    if (!parent) break;
    chain.push(parent.name);
    cur = parent;
  }
  return chain;
}

/** Nearest gazetteer entry to a coordinate; null beyond maxKm (default 25). */
export function nearestWithin(
  lat: number,
  lng: number,
  maxKm = 25,
): { entry: GazetteerEntry; distanceKm: number } | null {
  let best: { entry: GazetteerEntry; distanceKm: number } | null = null;
  let bestEffective = Infinity;
  for (const entry of GAZETTEER) {
    const d = haversineKm({ lat, lng }, { lat: entry.lat, lng: entry.lng });
    if (d > maxKm) continue;
    // Importance bias: bigger places "own" more area around them, so a query
    // point near several centers resolves to the most significant one.
    const effective = d - entry.importance * 3;
    if (effective < bestEffective) {
      bestEffective = effective;
      best = { entry, distanceKm: d };
    }
  }
  return best;
}
