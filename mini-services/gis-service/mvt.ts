// mvt.ts — minimal Mapbox Vector Tile v2.1 encoder, protobuf wire format
// written by hand (zero dependencies).
//
// Wire format (vector_tile.proto):
//   Tile   { repeated Layer layers = 3; }                       → key 0x1a
//   Layer  { string name = 1; repeated Feature features = 2;
//            repeated string keys = 3; repeated Value values = 4;
//            uint32 extent = 5 [default 4096]; uint32 version = 15; }
//   Feature{ uint64 id = 1; repeated uint32 tags = 2 [packed=true];
//            GeomType type = 3; repeated uint32 geometry = 4 [packed=true]; }
//   Value  { string string_value = 1; float float_value = 2;
//            double double_value = 3; int64 int_value = 4;
//            uint64 uint_value = 5; sint64 sint_value = 6; bool bool_value = 7; }
//
// Geometry command stream: MoveTo=1, LineTo=2, ClosePath=7;
//   command integer = (id & 0x7) | (count << 3);
//   parameters are zigzag varints: zz(n) = (n << 1) ^ (n >> 31).

export const enum MvtGeometryType {
  POINT = 1,
  LINE = 2,
  POLYGON = 3,
}

export type MvtTagValue = string | number | boolean;

export interface MvtFeature {
  id?: number;
  type: MvtGeometryType;
  /** Tile-local integer coordinates [x, y] within [0, extent). */
  geometry: [number, number][];
  tags?: Record<string, MvtTagValue>;
}

export interface MvtLayer {
  name: string;
  extent?: number; // default 4096
  features: MvtFeature[];
}

const textEncoder = new TextEncoder();

/** Zigzag-encode a signed 32-bit delta for the command stream. */
export function zigzag(n: number): number {
  return ((n << 1) ^ (n >> 31)) >>> 0;
}

/** Push a base-128 varint into an output buffer. */
export function varintInto(out: number[], value: number): void {
  let v = value >>> 0;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

class ByteWriter {
  private bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }

  private pushVarint(value: number): this {
    varintInto(this.bytes, value >>> 0);
    return this;
  }

  /** Varint field (wire type 0). */
  varintField(field: number, value: number): this {
    this.bytes.push((field << 3) | 0);
    return this.pushVarint(value);
  }

  /** Length-delimited field (wire type 2) over raw bytes. */
  lenDelim(field: number, data: number[] | Uint8Array): this {
    this.bytes.push((field << 3) | 2);
    this.pushVarint(data.length);
    for (const b of data) this.bytes.push(b);
    return this;
  }

  stringField(field: number, s: string): this {
    return this.lenDelim(field, textEncoder.encode(s));
  }

  /** 64-bit field (wire type 1) holding a little-endian double. */
  doubleField(field: number, v: number): this {
    this.bytes.push((field << 3) | 1);
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) this.bytes.push(dv.getUint8(i));
    return this;
  }

  finish(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

/** Wrap a scalar into a protobuf Value sub-message (field selection by type). */
function encodeValue(value: MvtTagValue): number[] {
  const w = new ByteWriter();
  if (typeof value === "string") {
    w.stringField(1, value); // string_value
  } else if (typeof value === "number") {
    w.doubleField(3, value); // double_value
  } else {
    w.varintField(7, value ? 1 : 0); // bool_value
  }
  return Array.from(w.finish());
}

/** Encode the geometry command stream (packed varints) for one feature.
 *  NOTE: command words are VARINTS (the field is repeated uint32 packed) —
 *  pushing them as raw bytes truncates values ≥ 256 and desyncs parsers
 *  for any line/ring with ≥ 17 points (e.g. the 40-point country border). */
function encodeGeometry(type: MvtGeometryType, coords: [number, number][]): number[] {
  const out: number[] = [];
  const emitCommand = (id: number, count: number): void => {
    varintInto(out, (id & 0x7) | (count << 3));
  };
  let cursorX = 0;
  let cursorY = 0;
  const emit = (x: number, y: number): void => {
    varintInto(out, zigzag(x - cursorX));
    varintInto(out, zigzag(y - cursorY));
    cursorX = x;
    cursorY = y;
  };

  if (type === MvtGeometryType.POINT) {
    // [MoveTo(1), dx, dy] per point (we emit one point per feature).
    emitCommand(1, 1);
    emit(coords[0][0], coords[0][1]);
  } else if (type === MvtGeometryType.LINE) {
    // MoveTo(1) first point, LineTo(n-1) the rest.
    if (coords.length < 2) return []; // degenerate — never emit MoveTo-only lines
    emitCommand(1, 1);
    emit(coords[0][0], coords[0][1]);
    emitCommand(2, coords.length - 1);
    for (let i = 1; i < coords.length; i++) emit(coords[i][0], coords[i][1]);
  } else {
    // Exterior ring: drop an explicit closing point if present, then
    // MoveTo(1) + LineTo(n-1) + ClosePath(7).
    const ring =
      coords.length > 1 &&
      coords[0][0] === coords[coords.length - 1][0] &&
      coords[0][1] === coords[coords.length - 1][1]
        ? coords.slice(0, -1)
        : coords;
    if (ring.length < 3) return [];
    emitCommand(1, 1);
    emit(ring[0][0], ring[0][1]);
    emitCommand(2, ring.length - 1);
    for (let i = 1; i < ring.length; i++) emit(ring[i][0], ring[i][1]);
    emitCommand(7, 1);
  }
  return out;
}

function encodeLayer(layer: MvtLayer): Uint8Array {
  const w = new ByteWriter();
  const keys: string[] = [];
  const keyIdx = new Map<string, number>();
  const valueEncodings: number[][] = [];
  const valueIdx = new Map<string, number>();

  const internKey = (k: string): number => {
    let idx = keyIdx.get(k);
    if (idx === undefined) {
      idx = keys.length;
      keys.push(k);
      keyIdx.set(k, idx);
    }
    return idx;
  };
  const internValue = (v: MvtTagValue): number => {
    const key = `${typeof v}:${String(v)}`;
    let idx = valueIdx.get(key);
    if (idx === undefined) {
      idx = valueEncodings.length;
      valueEncodings.push(encodeValue(v));
      valueIdx.set(key, idx);
    }
    return idx;
  };

  // version = 2 (field 15, varint) — MVT 2.1
  w.varintField(15, 2);
  w.stringField(1, layer.name);

  for (const feature of layer.features) {
    const fw = new ByteWriter();
    if (feature.id !== undefined) fw.varintField(1, feature.id);
    const tags: number[] = [];
    for (const [k, v] of Object.entries(feature.tags ?? {})) {
      tags.push(internKey(k), internValue(v));
    }
    if (tags.length) fw.lenDelim(2, tags); // packed varints
    fw.varintField(3, feature.type);
    const geometry = encodeGeometry(feature.type, feature.geometry);
    if (!geometry.length) continue;
    fw.lenDelim(4, geometry); // packed varints
    w.lenDelim(2, fw.finish()); // repeated Feature features = 2
  }

  for (const k of keys) w.stringField(3, k); // repeated string keys
  for (const v of valueEncodings) w.lenDelim(4, v); // repeated Value values
  w.varintField(5, layer.extent ?? 4096);
  return w.finish();
}

/**
 * Encode a tile. Empty layers are still emitted (valid protobuf, 0 features)
 * so every tile body is parseable and starts with the Tile.layers key byte
 * 0x1a — matches TileServer GL behaviour of serving well-formed empty tiles.
 */
export function encodeTile(layers: MvtLayer[]): Uint8Array {
  const w = new ByteWriter();
  for (const layer of layers) {
    w.lenDelim(3, encodeLayer(layer)); // repeated Layer layers = 3
  }
  return w.finish();
}
