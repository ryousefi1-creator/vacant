'use client';
import { useMemo } from 'react';

// Isometric cartoonish parking lot. Each detected car is snapped to the stall
// NEAREST its real top-down position (projected via the camera homography in
// scripts/spatial.py), so the layout looks like a real lot AND a car on the
// right of the lot shows on the right here. Empty stalls glow emerald = vacant.
type Car = { x: number; y: number };

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

const GW = 1, GD = 1.55, M = 0.85; // stall width, depth, margin (grid units)

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * f) | 0;
  const b = Math.min(255, (n & 255) * f) | 0;
  return `rgb(${r},${g},${b})`;
}
const ptsOf = (a: [number, number][]) => a.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

export default function LotMap({
  map, cars, surface, capacity,
}: {
  map: [number, number] | null;
  cars: Car[] | null;
  surface: string | null;
  capacity: number | null;
}) {
  const svg = useMemo(() => {
    if (!map || !cars) return null;
    const [W, H] = map;
    const [C, R] = factorGrid(capacity || Math.max(8, cars.length + 4));

    // ground-plane projection, auto-fit to the viewBox
    const raw = (gx: number, gy: number, gz = 0): [number, number] => [gx - gy, (gx + gy) * 0.5 - gz * 0.62];
    const corners: [number, number][] = [[-M, -M], [C * GW + M, -M], [C * GW + M, R * GD + M], [-M, R * GD + M]];
    const rx = corners.map((c) => raw(c[0], c[1]));
    const VBW = 1000, VBH = 620, pad = 54, topPad = 0.62; // headroom for car height at back
    const minX = Math.min(...rx.map((p) => p[0])), maxX = Math.max(...rx.map((p) => p[0]));
    const minY = Math.min(...rx.map((p) => p[1])) - topPad, maxY = Math.max(...rx.map((p) => p[1]));
    const s = Math.min((VBW - 2 * pad) / (maxX - minX), (VBH - 2 * pad) / (maxY - minY));
    const OX = pad - minX * s + ((VBW - 2 * pad) - (maxX - minX) * s) / 2;
    const OY = pad - minY * s;
    const P = (gx: number, gy: number, gz = 0): [number, number] => {
      const [x, y] = raw(gx, gy, gz);
      return [OX + x * s, OY + y * s];
    };
    const quad = (gx: number, gy: number, w: number, d: number, gz = 0) =>
      [P(gx, gy, gz), P(gx + w, gy, gz), P(gx + w, gy + d, gz), P(gx, gy + d, gz)] as [number, number][];

    // build stalls (depth-sorted: back rows first) + assign cars to nearest free stall
    const spots = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++)
      spots.push({ c, r, nx: C > 1 ? c / (C - 1) : 0.5, ny: R > 1 ? r / (R - 1) : 0.5 });
    const occ = new Array(spots.length).fill(false);
    for (const car of cars) {
      const cx = car.x / W, cy = car.y / H;
      let bi = -1, bd = 1e9;
      spots.forEach((sp, i) => { if (occ[i]) return; const d = (sp.nx - cx) ** 2 + (sp.ny - cy) ** 2; if (d < bd) { bd = d; bi = i; } });
      if (bi >= 0) occ[bi] = true;
    }

    // slab
    const slab = ptsOf(quad(-M, -M, C * GW + 2 * M, R * GD + 2 * M));
    let out = `<polygon points="${slab}" fill="url(#asph)" stroke="#11161d" stroke-width="3"/>`;
    // curb highlight
    out += `<polygon points="${slab}" fill="none" stroke="#566173" stroke-width="2" opacity=".5"/>`;

    // stalls + cars, painted back-to-front so near cars overlap far ones
    spots.forEach((sp, i) => {
      const gx = sp.c * GW, gy = sp.r * GD;
      const inset = 0.07;
      const cell = quad(gx + inset, gy + inset, GW - 2 * inset, GD - 2 * inset);
      const isOcc = occ[i];
      // stall floor: vacant = emerald glow, taken = dark asphalt
      out += `<polygon points="${ptsOf(cell)}" fill="${isOcc ? 'rgba(15,22,30,.30)' : 'rgba(16,185,129,.78)'}" stroke="#f4f7fa" stroke-width="2.4" stroke-linejoin="round"/>`;
      if (!isOcc) {
        // little "open" pip
        const [px, py] = P(gx + GW / 2, gy + GD / 2);
        out += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" fill="#fff" opacity=".85"/>`;
      } else {
        // iso car
        let h = 0; for (const ch of `${sp.c}-${sp.r}`) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
        const col = CAR_COLORS[h % CAR_COLORS.length];
        const bw = GW * 0.6, bd = GD * 0.62, bx = gx + (GW - bw) / 2, by = gy + (GD - bd) / 2, bh = 0.5;
        const shadow = quad(bx - 0.06, by - 0.04, bw + 0.12, bd + 0.12, 0);
        const bodyT = quad(bx, by, bw, bd, bh), bodyR = [bodyT[1], P(bx + bw, by, 0), P(bx + bw, by + bd, 0), bodyT[2]] as [number, number][];
        const bodyF = [bodyT[3], bodyT[2], P(bx + bw, by + bd, 0), P(bx, by + bd, 0)] as [number, number][];
        const cx0 = bx + 0.07, cy0 = by + 0.2, cw = bw - 0.14, cd = bd * 0.46, z0 = bh, z1 = bh + 0.34;
        const cabT = quad(cx0, cy0, cw, cd, z1), cabR = [cabT[1], P(cx0 + cw, cy0, z0), P(cx0 + cw, cy0 + cd, z0), cabT[2]] as [number, number][];
        const cabF = [cabT[3], cabT[2], P(cx0 + cw, cy0 + cd, z0), P(cx0, cy0 + cd, z0)] as [number, number][];
        const glass = '#243240';
        // windshield highlight strip across the cab top
        const wsT = quad(cx0, cy0, cw, cd * 0.4, z1);
        out += `<polygon points="${ptsOf(shadow)}" fill="rgba(10,14,18,.22)"/>`
          + `<polygon points="${ptsOf(bodyF)}" fill="${shade(col, .72)}"/>`
          + `<polygon points="${ptsOf(bodyR)}" fill="${shade(col, .88)}"/>`
          + `<polygon points="${ptsOf(bodyT)}" fill="${col}" stroke="${shade(col, .6)}" stroke-width="1"/>`
          + `<polygon points="${ptsOf(cabF)}" fill="${shade(glass, .82)}"/>`
          + `<polygon points="${ptsOf(cabR)}" fill="${shade(glass, .98)}"/>`
          + `<polygon points="${ptsOf(cabT)}" fill="${glass}"/>`
          + `<polygon points="${ptsOf(wsT)}" fill="#9fb6c8" opacity=".55"/>`;
      }
    });

    return out;
  }, [map, cars, surface, capacity]);

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
      </defs>
      <g dangerouslySetInnerHTML={{ __html: svg }} />
    </svg>
  );
}
