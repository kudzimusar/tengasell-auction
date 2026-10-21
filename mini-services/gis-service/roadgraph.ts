// roadgraph.ts — Zimbabwe major-road network graph.
//
// Nodes = the 6 cities + junction towns. Edges carry approximate ROAD
// distances in km (A-highway corridor figures). Coordinates reuse the
// gazetteer values where a node is also a gazetteer place. This is the graph
// behind OSRM-style /route + /table and the "roads" layer in vector tiles.

export interface RoadNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface RoadEdge {
  from: string;
  to: string;
  km: number;
  name: string;
}

export const ROAD_NODES: RoadNode[] = [
  { id: "harare", name: "Harare", lat: -17.8292, lng: 31.0522 },
  { id: "bulawayo", name: "Bulawayo", lat: -20.15, lng: 28.5873 },
  { id: "gweru", name: "Gweru", lat: -19.45, lng: 29.8167 },
  { id: "kwekwe", name: "Kwekwe", lat: -18.9281, lng: 29.8149 },
  { id: "kadoma", name: "Kadoma", lat: -18.3178, lng: 30.9111 },
  { id: "chegutu", name: "Chegutu", lat: -18.1333, lng: 30.1333 },
  { id: "masvingo", name: "Masvingo", lat: -20.0744, lng: 30.889 },
  { id: "mutare", name: "Mutare", lat: -18.9707, lng: 32.5707 },
  { id: "chinhoyi", name: "Chinhoyi", lat: -17.3667, lng: 30.2 },
  { id: "kariba", name: "Kariba", lat: -16.5167, lng: 28.8667 },
  { id: "marondera", name: "Marondera", lat: -18.1853, lng: 31.7515 },
  { id: "rusape", name: "Rusape", lat: -18.5167, lng: 32.1167 },
  { id: "nyanga", name: "Nyanga", lat: -18.2143, lng: 32.7559 },
  { id: "bindura", name: "Bindura", lat: -17.3019, lng: 31.3306 },
  { id: "chivhu", name: "Chivhu", lat: -19.2, lng: 30.9 },
  { id: "zvishavane", name: "Zvishavane", lat: -20.3167, lng: 30.0333 },
  { id: "chiredzi", name: "Chiredzi", lat: -21.05, lng: 31.4667 },
  { id: "beitbridge", name: "Beitbridge", lat: -22.2167, lng: 30.0 },
  { id: "gokwe", name: "Gokwe", lat: -18.2167, lng: 28.9333 },
  { id: "hwange", name: "Hwange", lat: -18.3667, lng: 26.5 },
  { id: "victoria-falls", name: "Victoria Falls", lat: -17.9316, lng: 25.8318 },
  { id: "karoi", name: "Karoi", lat: -16.8167, lng: 29.6833 },
  { id: "plumtree", name: "Plumtree", lat: -20.4667, lng: 27.8167 },
  { id: "murewa", name: "Murewa", lat: -17.649, lng: 31.784 },
  { id: "chirundu", name: "Chirundu", lat: -16.0333, lng: 28.85 },
  { id: "gwanda", name: "Gwanda", lat: -20.9333, lng: 29.0167 },
  { id: "lupane", name: "Lupane", lat: -18.9333, lng: 27.7667 },
];

/** Approximate ROAD distances (km) between corridor towns. */
export const ROAD_EDGES: RoadEdge[] = [
  // A5 Harare–Bulawayo corridor (and its towns)
  { from: "harare", to: "bulawayo", km: 439, name: "A5 Harare–Bulawayo Highway" },
  { from: "harare", to: "chegutu", km: 106, name: "A5 Harare–Chegutu" },
  { from: "chegutu", to: "kadoma", km: 83, name: "A5 Chegutu–Kadoma" },
  { from: "kadoma", to: "kwekwe", km: 71, name: "A5 Kadoma–Kwekwe" },
  { from: "kwekwe", to: "gweru", km: 72, name: "A5 Kwekwe–Gweru" },
  { from: "gweru", to: "bulawayo", km: 164, name: "A5 Gweru–Bulawayo" },
  { from: "gokwe", to: "kwekwe", km: 150, name: "Kwekwe–Gokwe Road" },

  // A3 Harare–Mutare (Eastern corridor + Nyanga spur)
  { from: "harare", to: "mutare", km: 265, name: "A3 Harare–Mutare Highway" },
  { from: "harare", to: "marondera", km: 74, name: "A3 Harare–Marondera" },
  { from: "marondera", to: "rusape", km: 90, name: "A3 Marondera–Rusape" },
  { from: "rusape", to: "mutare", km: 100, name: "A3 Rusape–Mutare" },
  { from: "harare", to: "rusape", km: 170, name: "A3 Harare–Rusape" },
  { from: "mutare", to: "nyanga", km: 82, name: "Mutare–Nyanga Road" },

  // A4 Harare–Beitbridge corridor (south) + Masvingo web
  { from: "harare", to: "masvingo", km: 292, name: "A4 Harare–Beitbridge Highway" },
  { from: "harare", to: "chivhu", km: 164, name: "A4 Harare–Chivhu" },
  { from: "chivhu", to: "masvingo", km: 128, name: "A4 Chivhu–Masvingo" },
  { from: "masvingo", to: "beitbridge", km: 283, name: "A4 Masvingo–Beitbridge" },
  { from: "masvingo", to: "chiredzi", km: 120, name: "Masvingo–Chiredzi Road" },
  { from: "masvingo", to: "gweru", km: 200, name: "Masvingo–Gweru Road" },
  { from: "masvingo", to: "zvishavane", km: 97, name: "Masvingo–Zvishavane Road" },
  { from: "zvishavane", to: "gweru", km: 119, name: "Zvishavane–Gweru Road" },
  { from: "mutare", to: "masvingo", km: 290, name: "Mutare–Masvingo Road" },

  // North (A1/A2/S8)
  { from: "harare", to: "chinhoyi", km: 115, name: "A1 Harare–Chinhoyi Road" },
  { from: "harare", to: "bindura", km: 89, name: "A6 Harare–Bindura Road" },
  { from: "harare", to: "murewa", km: 75, name: "A2 Harare–Murewa Road" },
  { from: "marondera", to: "murewa", km: 47, name: "Marondera–Murewa Road" },
  { from: "chinhoyi", to: "kariba", km: 156, name: "S8 Chinhoyi–Kariba Road" },
  { from: "chinhoyi", to: "karoi", km: 85, name: "A1 Chinhoyi–Karoi" },
  { from: "karoi", to: "kariba", km: 90, name: "Karoi–Kariba Road" },
  { from: "kariba", to: "chirundu", km: 60, name: "Kariba–Chirundu Road" },

  // West (Matabeleland)
  { from: "bulawayo", to: "victoria-falls", km: 439, name: "A8 Bulawayo–Victoria Falls Road" },
  { from: "bulawayo", to: "hwange", km: 289, name: "Bulawayo–Hwange Road" },
  { from: "hwange", to: "victoria-falls", km: 105, name: "A8 Hwange–Victoria Falls" },
  { from: "bulawayo", to: "plumtree", km: 100, name: "A7 Bulawayo–Plumtree Road" },
  { from: "bulawayo", to: "gwanda", km: 150, name: "A6 Bulawayo–Gwanda Road" },
  { from: "gwanda", to: "beitbridge", km: 160, name: "A6 Gwanda–Beitbridge Road" },
  { from: "bulawayo", to: "lupane", km: 170, name: "Bulawayo–Lupane Road" },
  { from: "lupane", to: "hwange", km: 120, name: "Lupane–Hwange Road" },
];

// ── Graph plumbing ───────────────────────────────────────────────────────────

const nodeById = new Map<string, RoadNode>(ROAD_NODES.map((n) => [n.id, n]));
const nodeIndex = new Map<string, number>(ROAD_NODES.map((n, i) => [n.id, i]));

/** Adjacency: node id → [{ to, km, name }] */
export const ADJACENCY = new Map<string, { to: RoadNode; km: number; name: string }[]>(
  ROAD_NODES.map((n) => [n.id, []]),
);
for (const edge of ROAD_EDGES) {
  const a = nodeById.get(edge.from);
  const b = nodeById.get(edge.to);
  if (!a || !b) continue;
  ADJACENCY.get(edge.from)!.push({ to: b, km: edge.km, name: edge.name });
  ADJACENCY.get(edge.to)!.push({ to: a, km: edge.km, name: edge.name });
}

export function getNode(id: string): RoadNode | null {
  return nodeById.get(id) ?? null;
}

export function nodeIndexById(id: string): number | null {
  return nodeIndex.get(id) ?? null;
}

/** Dijkstra over the road graph. Returns node-id path (inclusive) + total km. */
export function dijkstra(
  startId: string,
  goalId: string,
): { path: string[]; km: number } | null {
  if (startId === goalId) return { path: [startId], km: 0 };
  const n = ROAD_NODES.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<string | null>(n).fill(null);
  const done = new Array<boolean>(n).fill(false);
  const startIndex = nodeIndex.get(startId);
  if (startIndex === undefined) return null;
  dist[startIndex] = 0;

  for (let round = 0; round < n; round++) {
    let u = -1;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i] < bestDist) {
        bestDist = dist[i];
        u = i;
      }
    }
    if (u === -1) break;
    if (ROAD_NODES[u].id === goalId) break;
    done[u] = true;
    for (const link of ADJACENCY.get(ROAD_NODES[u].id) ?? []) {
      const v = nodeIndex.get(link.to.id);
      if (v === undefined || done[v]) continue;
      const candidate = dist[u] + link.km;
      if (candidate < dist[v]) {
        dist[v] = candidate;
        prev[v] = ROAD_NODES[u].id;
      }
    }
  }

  const goalIndex = nodeIndex.get(goalId);
  if (goalIndex === undefined || dist[goalIndex] === Infinity) return null;
  const path: string[] = [goalId];
  let cur: string | null = goalId;
  const guard = 200;
  let steps = 0;
  while (cur !== startId && steps++ < guard) {
    const idx = nodeIndex.get(cur!)!;
    cur = prev[idx];
    if (!cur) return null;
    path.unshift(cur);
  }
  return { path, km: dist[goalIndex] };
}

/** Nearest road-graph node to a coordinate. */
export function nearestNode(
  lat: number,
  lng: number,
): { node: RoadNode; km: number } {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  let best = ROAD_NODES[0];
  let bestKm = Infinity;
  for (const node of ROAD_NODES) {
    const dLat = rad(node.lat - lat);
    const dLng = rad(node.lng - lng);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h =
      sinLat * sinLat +
      Math.cos(rad(lat)) * Math.cos(rad(node.lat)) * sinLng * sinLng;
    const d = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    if (d < bestKm) {
      bestKm = d;
      best = node;
    }
  }
  return { node: best, km: bestKm };
}

/** Edge between two adjacent node ids (either direction), or null. */
export function edgeBetween(aId: string, bId: string): RoadEdge | null {
  return (
    ROAD_EDGES.find(
      (e) =>
        (e.from === aId && e.to === bId) || (e.from === bId && e.to === aId),
    ) ?? null
  );
}
