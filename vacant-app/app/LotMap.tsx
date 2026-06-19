'use client';
import { useMemo } from 'react';
import { synthLayout, snapCars, type LearnedLayout } from './layoutGeom';

// Isometric cartoonish parking lot, three sources (all drawn by one rotation-aware loop):
//  - PAVED (stalls present): each REAL marked stall in its true position (projected to
//    top-down via the camera homography in scripts/spatial.py), colored by EXACT occupancy.
//  - LEARNED LAYOUT (gravel + calib/<id>_layout_learned.json): the lot's REAL shape 1:1 via
//    synthLayout() — real rows, real stall counts, per-row angles, landscaped islands — with
//    detected cars snapped onto real stalls.
//  - GRAVEL fallback (no learned layout): snap cars to a generated capacity grid.
// Empty stalls glow emerald = vacant; taken stalls get an iso car model.
type Car = { x: number; y: number };
type Stall = { poly: [number, number][]; taken: boolean };
type Spot = { cx: number; cz: number; w: number; d: number; rot: number; isOcc: boolean; key: string };
type Island = { cx: number; cz: number; rx: number; rz: number };

const CAR_COLORS = ['#3a4654', '#c0492f', '#2f6fb0', '#1f7a5a', '#d7a13a', '#cfd6dd', '#7a8694', '#b23b3b'];

// pick a cols×rows grid whose product is ~capacity and looks like a wide lot
function factorGrid(cap: number): [number, number] {
  cap = Math.max(4, Math.min(64, Math.round(cap)));
  let best: [number, number] = [cap, 1], bestScore = 1e9;
  for (let r = 2; r <= 8; r++) {
    const c = Math.round(cap / r);
    if (c < 2) continue;
    const score = Math.abs(c * r - cap) * 2 + Math.abs(c / r - 1.7);
    if (score < bestScore) { bestScore = score; best = [c, r]; }
  }
  return best;
}

const GW = 1.6, GD = 2.0, AISLE = 1.1; // fallback-grid stall width, depth, aisle (grid units)

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * f) | 0;
  const b = Math.min(255, (n & 255) * f) | 0;
  return `rgb(${r},${g},${b})`;
}
const ptsOf = (a: [number, number][]) => a.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

export default function LotMap({
  map, cars, surface, capacity, stalls, layout,
}: {
  map: [number, number] | null;
  cars: Car[] | null;
  surface: string | null;
  capacity: number | null;
  stalls: Stall[] | null;
  layout?: LearnedLayout | null;
}) {
  const svg = useMemo(() => {
    // 1) build a common list of stalls (center + size + rotation), tagged occupied,
    //    plus any landscaped islands. Everything below is source-agnostic.
    let spots: Spot[] = [];
    const islands: Island[] = [];
    const geom = !(stalls && stalls.length) ? synthLayout(layout) : null;

    if (stalls && stalls.length) {
      // PAVED: real stalls at real top-down positions. Normalize so one stall ~ 1 unit.
      const boxes = stalls.map((s) => {
        const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
        return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), taken: s.taken };
      });
      const areas = boxes.map((b) => b.w * b.h).sort((a, b) => a - b);
      const U = Math.sqrt(areas[Math.floor(areas.length / 2)] || 1) || 1;
      spots = boxes.map((b, i) => ({ cx: (b.x + b.w / 2) / U, cz: (b.y + b.h / 2) / U, w: b.w / U, d: b.h / U, rot: 0, isOcc: b.taken, key: 's' + i }));
    } else if (geom) {
      // LEARNED LAYOUT: real rows / angles / islands, cars snapped onto real stalls.
      const occ = snapCars(geom.stalls, cars, map?.[0] ?? 0, map?.[1] ?? 0);
      spots = geom.stalls.map((s, i) => ({ cx: s.x, cz: s.z, w: s.w, d: s.d, rot: (s.rotDeg * Math.PI) / 180, isOcc: occ[i], key: s.key }));
      geom.islands.forEach((is) => islands.push({ cx: is.x, cz: is.z, rx: is.rx, rz: is.rz }));
    } else if (map && cars) {
      // GRAVEL fallback: snap detected cars to nearest free generated stall.
      const [W, H] = map;
      const [C, R] = factorGrid(capacity || Math.max(8, cars.length + 4));
      const rowPitch = GD + AISLE, gridW = C * GW, gridD = R * rowPitch;
      const gen = [] as { cx: number; cz: number; nx: number; ny: number; key: string }[];
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++)
        gen.push({ cx: (c + 0.5) * GW - gridW / 2, cz: (r + 0.5) * rowPitch - gridD / 2, nx: C > 1 ? c / (C - 1) : 0.5, ny: R > 1 ? r / (R - 1) : 0.5, key: c + '-' + r });
      const occ = new Array(gen.length).fill(false);
      for (const car of cars) {
        const cx = car.x / W, cy = car.y / H;
        let bi = -1, bd = 1e9;
        gen.forEach((sp, i) => { if (occ[i]) return; const dd = (sp.nx - cx) ** 2 + (sp.ny - cy) ** 2; if (dd < bd) { bd = dd; bi = i; } });
        if (bi >= 0) occ[bi] = true;
      }
      spots = gen.map((g, i) => ({ cx: g.cx, cz: g.cz, w: GW, d: GD, rot: 0, isOcc: occ[i], key: g.key }));
    } else return null;

    if (!spots.length) return null;

    // 2) ground-plane iso projection, auto-fit to the viewBox. Account for per-stall
    //    rotation by fitting over each stall's four rotated ground corners.
    const raw = (gx: number, gy: number, gz = 0): [number, number] => [gx - gy, (gx + gy) * 0.5 - gz * 0.62];
    const cornersOf = (s: { cx: number; cz: number; w: number; d: number; rot: number }) => {
      const ca = Math.cos(s.rot), sa = Math.sin(s.rot);
      const out: [number, number][] = [];
      for (const sx of [-s.w / 2, s.w / 2]) for (const sz of [-s.d / 2, s.d / 2])
        out.push([s.cx + sx * ca - sz * sa, s.cz + sx * sa + sz * ca]);
      return out;
    };
    const groundPts = [
      ...spots.flatMap(cornersOf),
      ...islands.flatMap((is) => [[is.cx - is.rx, is.cz - is.rz], [is.cx + is.rx, is.cz + is.rz]] as [number, number][]),
    ];
    const M = 0.9;
    const minGX = Math.min(...groundPts.map((p) => p[0])) - M, maxGX = Math.max(...groundPts.map((p) => p[0])) + M;
    const minGY = Math.min(...groundPts.map((p) => p[1])) - M, maxGY = Math.max(...groundPts.map((p) => p[1])) + M;
    const rectCorners: [number, number][] = [[minGX, minGY], [maxGX, minGY], [maxGX, maxGY], [minGX, maxGY]];
    const rx = rectCorners.map((c) => raw(c[0], c[1]));
    const VBW = 1000, VBH = 620, pad = 54, topPad = 0.62; // headroom for car height at back
    const minX = Math.min(...rx.map((p) => p[0])), maxX = Math.max(...rx.map((p) => p[0]));
    const minY = Math.min(...rx.map((p) => p[1])) - topPad, maxY = Math.max(...rx.map((p) => p[1]));
    const sc = Math.min((VBW - 2 * pad) / (maxX - minX), (VBH - 2 * pad) / (maxY - minY));
    const OX = pad - minX * sc + ((VBW - 2 * pad) - (maxX - minX) * sc) / 2;
    const OY = pad - minY * sc;
    const P = (gx: number, gy: number, gz = 0): [number, number] => {
      const [x, y] = raw(gx, gy, gz);
      return [OX + x * sc, OY + y * sc];
    };
    // a local, rotation-aware projector centered on a stall/island
    const local = (cx: number, cz: number, rot: number) => {
      const ca = Math.cos(rot), sa = Math.sin(rot);
      return (lx: number, lz: number, gz = 0) => P(cx + lx * ca - lz * sa, cz + lx * sa + lz * ca, gz);
    };
    const lq = (lp: (lx: number, lz: number, gz?: number) => [number, number], lx: number, lz: number, w: number, d: number, gz = 0) =>
      [lp(lx, lz, gz), lp(lx + w, lz, gz), lp(lx + w, lz + d, gz), lp(lx, lz + d, gz)] as [number, number][];

    // ground slab over the whole footprint
    const slab = ptsOf([P(minGX, minGY), P(maxGX, minGY), P(maxGX, maxGY), P(minGX, maxGY)]);
    const ground = surface === 'gravel' ? 'url(#grav)' : 'url(#asph)';
    let out = `<polygon points="${slab}" fill="${ground}" stroke="#11161d" stroke-width="3"/>`;
    out += `<polygon points="${slab}" fill="none" stroke="#566173" stroke-width="2" opacity=".4"/>`;

    // 3) draw back-to-front (islands + stalls + cars interleaved by depth)
    type Item = { kind: 'stall' | 'island'; idx: number; depth: number };
    const items: Item[] = [
      ...spots.map((s, i) => ({ kind: 'stall' as const, idx: i, depth: s.cz + s.d / 2 })),
      ...islands.map((is, i) => ({ kind: 'island' as const, idx: i, depth: is.cz + is.rz })),
    ].sort((a, b) => a.depth - b.depth);

    for (const it of items) {
      if (it.kind === 'island') {
        const is = islands[it.idx];
        const ip = local(is.cx, is.cz, 0);
        const planter = lq(ip, -is.rx, -is.rz, 2 * is.rx, 2 * is.rz, 0);
        const [fx, fy] = ip(0, 0, 0.25);
        out += `<polygon points="${ptsOf(planter)}" fill="#8a7a5c" stroke="#6f6047" stroke-width="1.5" stroke-linejoin="round"/>`
          + `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="${(is.rx * sc * 0.7).toFixed(1)}" fill="#4f8f57"/>`
          + `<circle cx="${fx.toFixed(1)}" cy="${(fy - is.rx * sc * 0.35).toFixed(1)}" r="${(is.rx * sc * 0.45).toFixed(1)}" fill="#5fa667"/>`;
        continue;
      }
      const sp = spots[it.idx];
      const W = sp.w, D = sp.d;
      const lp = local(sp.cx, sp.cz, sp.rot);
      const inset = 0.07 * Math.min(W, D);
      const cell = lq(lp, -W / 2 + inset, -D / 2 + inset, W - 2 * inset, D - 2 * inset);
      out += `<polygon points="${ptsOf(cell)}" fill="${sp.isOcc ? 'rgba(120,110,86,.32)' : 'rgba(16,185,129,.78)'}" stroke="#f4f7fa" stroke-width="2.4" stroke-linejoin="round"/>`;
      if (!sp.isOcc) {
        const [px, py] = lp(0, 0);
        out += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" fill="#fff" opacity=".85"/>`;
      } else {
        let h = 0; for (const ch of sp.key) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
        const col = CAR_COLORS[h % CAR_COLORS.length];
        const bw = W * 0.6, bd = D * 0.62, bh = 0.5;
        const shadow = lq(lp, -bw / 2 - 0.06 * W, -bd / 2 - 0.04 * D, bw + 0.12 * W, bd + 0.12 * D, 0);
        const bodyT = lq(lp, -bw / 2, -bd / 2, bw, bd, bh);
        const bodyR = [bodyT[1], lp(bw / 2, -bd / 2, 0), lp(bw / 2, bd / 2, 0), bodyT[2]] as [number, number][];
        const bodyF = [bodyT[3], bodyT[2], lp(bw / 2, bd / 2, 0), lp(-bw / 2, bd / 2, 0)] as [number, number][];
        const cw = bw * 0.8, cd = bd * 0.46, cmx = -0.4 * bw, cmz = -0.18 * bd, z0 = bh, z1 = bh + 0.34;
        const cabT = lq(lp, cmx, cmz, cw, cd, z1);
        const cabR = [cabT[1], lp(cmx + cw, cmz, z0), lp(cmx + cw, cmz + cd, z0), cabT[2]] as [number, number][];
        const cabF = [cabT[3], cabT[2], lp(cmx + cw, cmz + cd, z0), lp(cmx, cmz + cd, z0)] as [number, number][];
        const glass = '#243240';
        const wsT = lq(lp, cmx, cmz, cw, cd * 0.4, z1);
        out += `<polygon points="${ptsOf(shadow)}" fill="rgba(10,14,18,.22)"/>`
          + `<polygon points="${ptsOf(bodyF)}" fill="${shade(col, .72)}"/>`
          + `<polygon points="${ptsOf(bodyR)}" fill="${shade(col, .88)}"/>`
          + `<polygon points="${ptsOf(bodyT)}" fill="${col}" stroke="${shade(col, .6)}" stroke-width="1"/>`
          + `<polygon points="${ptsOf(cabF)}" fill="${shade(glass, .82)}"/>`
          + `<polygon points="${ptsOf(cabR)}" fill="${shade(glass, .98)}"/>`
          + `<polygon points="${ptsOf(cabT)}" fill="${glass}"/>`
          + `<polygon points="${ptsOf(wsT)}" fill="#9fb6c8" opacity=".55"/>`;
      }
    }

    return out;
  }, [map, cars, surface, capacity, stalls, layout]);

  if (!svg) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa6b2', fontSize: 13 }}>
        no spatial map for this feed
      </div>
    );
  }
  return (
    <svg viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        <linearGradient id="asph" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#454f5e" />
          <stop offset="1" stopColor="#353d4a" />
        </linearGradient>
        <linearGradient id="grav" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#bcae90" />
          <stop offset="1" stopColor="#a89c7e" />
        </linearGradient>
      </defs>
      <g dangerouslySetInnerHTML={{ __html: svg }} />
    </svg>
  );
}
