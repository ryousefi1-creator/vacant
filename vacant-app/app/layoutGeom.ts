// Shared geometry synthesizer. Turns the SEMANTIC learned layout
// (scripts/layout_learn.py output: rows + stall counts + angles + drive aisles +
// proportions + landmarks) into concrete top-down stall geometry, so the 2D iso
// map and the 3D twin both draw a lot's REAL shape 1:1 (e.g. coalton1 = 3 shallow
// rows of 8/6/6 angled spaces, broken up by landscaped islands) instead of a
// generic capacity grid. This is the "decouple layout from occupancy" step:
// layout comes from here, live cars get snapped on top by each renderer.
//
// Coordinates are centered on the origin, abstract world units:
//   x = left -> right,  z = front (near camera) -> back (far).
// Both renderers auto-fit to their viewport, so only RELATIVE scale matters.

export type LearnedRow = {
  id?: number; stalls?: number; orientation?: string; where?: string; angle_deg?: number;
};
export type LearnedLayout = {
  shape?: string; surface?: string; rows?: LearnedRow[]; drive_aisles?: number;
  capacity_est?: number; entrance?: string; landmarks?: string[];
  proportions?: { width_to_depth?: string }; notes?: string;
};

export type GeomStall = { x: number; z: number; w: number; d: number; rotDeg: number; row: number; key: string };
export type GeomIsland = { x: number; z: number; rx: number; rz: number };
export type LotGeom = { stalls: GeomStall[]; islands: GeomIsland[]; w: number; d: number };

const SW = 2.4;    // stall width  (along x)
const SD = 4.0;    // stall depth  (along z)
const AISLE = 3.0; // drive aisle between rows (along z)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
// front -> back ordering hint parsed from the row's free-text "where"
const depthRank = (where = '') =>
  /back|rear|north|far/i.test(where) ? 2 : /mid|cent/i.test(where) ? 1 : 0;
const sideBias = (where = '') =>
  /left|west/i.test(where) ? -1 : /right|east/i.test(where) ? 1 : 0;

export function synthLayout(spec: LearnedLayout | null | undefined): LotGeom | null {
  const rawRows = (spec?.rows ?? []).filter((r) => (r?.stalls ?? 0) > 0);
  if (!rawRows.length) return null;

  // order rows front -> back (by "where"; stable fallback to given order)
  const rows = rawRows
    .map((r, i) => ({ ...r, _i: i, _rank: depthRank(r.where) }))
    .sort((a, b) => a._rank - b._rank || a._i - b._i);

  const n = rows.length;
  const maxW = Math.max(...rows.map((r) => (r.stalls ?? 0) * SW));
  const D = n * SD + (n - 1) * AISLE; // total depth front->back

  const stalls: GeomStall[] = [];
  rows.forEach((r, ri) => {
    const count = r.stalls ?? 0;
    const rowW = count * SW;
    // nudge each row off-center per its "left/right" so the field reads as the real
    // irregular lot (front-left / middle-center / back-right) rather than a tidy stack
    const offX = sideBias(r.where) * Math.min(0.14 * maxW, Math.max(0, (maxW - rowW) / 2 + SW));
    const startX = -rowW / 2 + offX;
    const zc = -D / 2 + SD / 2 + ri * (SD + AISLE);
    // angle_deg: 90 = facing camera (straight pull-in), 0 = parallel. Render the lean.
    const rotDeg = clamp((r.angle_deg ?? 90) - 90, -28, 28);
    for (let i = 0; i < count; i++) {
      stalls.push({ x: startX + (i + 0.5) * SW, z: zc, w: SW, d: SD, rotDeg, row: ri, key: `r${ri}c${i}` });
    }
  });

  // landscaped islands that break up the parking field (central shade-tree island
  // in a drive aisle + a couple of curb end-caps on alternating sides)
  const islands: GeomIsland[] = [];
  if (n >= 2) {
    const aisleZ = -D / 2 + SD + AISLE / 2; // first aisle, behind the front row
    islands.push({ x: -0.06 * maxW, z: aisleZ, rx: 1.8, rz: AISLE * 0.4 });
  }
  const first = rows[0], last = rows[n - 1];
  islands.push({ x: ((first.stalls ?? 0) * SW) / 2 + SW * 0.65, z: -D / 2 + SD / 2, rx: 1.0, rz: SD * 0.36 });
  if (n >= 2) islands.push({ x: -((last.stalls ?? 0) * SW) / 2 - SW * 0.65, z: D / 2 - SD / 2, rx: 1.0, rz: SD * 0.36 });

  return { stalls, islands, w: maxW + 3 * SW, d: D + SD };
}

// Greedy nearest-free assignment of live cars onto synthesized stalls, by NORMALIZED
// position so "a car on the right shows on the right". Returns a boolean[] aligned to
// `stalls` (true = occupied). `cars` are top-down map coords; mw/mh = map size.
export function snapCars(
  stalls: GeomStall[],
  cars: { x: number; y: number }[] | null,
  mw: number, mh: number,
): boolean[] {
  const occ = new Array(stalls.length).fill(false);
  if (!cars?.length || !stalls.length) return occ;
  const xs = stalls.map((s) => s.x), zs = stalls.map((s) => s.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const nx = (x: number) => (maxX > minX ? (x - minX) / (maxX - minX) : 0.5);
  const nz = (z: number) => (maxZ > minZ ? (z - minZ) / (maxZ - minZ) : 0.5);
  for (const car of cars) {
    const cx = mw ? car.x / mw : 0.5, cy = mh ? car.y / mh : 0.5;
    let bi = -1, bd = Infinity;
    stalls.forEach((s, i) => {
      if (occ[i]) return;
      const dd = (nx(s.x) - cx) ** 2 + (nz(s.z) - cy) ** 2;
      if (dd < bd) { bd = dd; bi = i; }
    });
    if (bi >= 0) occ[bi] = true;
  }
  return occ;
}
