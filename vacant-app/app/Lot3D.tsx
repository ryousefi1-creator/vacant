'use client';
// Navigable cartoonish-realistic 3D lot. Orbit / pan / zoom with the mouse.
//  - asphalt slab + painted stall lines + wheel stops + a curb + a little landscaping (NO grid).
//  - LEARNED LAYOUT (gravel lot with a calib/<id>_layout_learned.json): draw the lot's REAL
//    top-down shape 1:1 via synthLayout() — real rows, real stall counts, per-row angles, and
//    landscaped islands — then snap each detected car onto a real stall.
//  - GRAVEL (no learned layout): generate a stall layout from capacity and snap cars (fallback).
//  - PAVED: use the real marked stalls.
// Vacant stalls glow emerald; taken stalls get a little car. Three.js is fine here (hosted Next app);
// the <Canvas> is mount-gated so it never renders during SSR.
import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { synthLayout, snapCars, type LearnedLayout } from './layoutGeom';

type Car = { x: number; y: number };
type Stall = { poly: [number, number][]; taken: boolean };
type Props = {
  map: [number, number] | null; cars: Car[] | null; surface: string | null;
  capacity: number | null; stalls: Stall[] | null; layout?: LearnedLayout | null;
};
type Spot = { x: number; z: number; w: number; d: number; rot: number; occ: boolean; color: string };
type Island = { x: number; z: number; rx: number; rz: number; tree: boolean };

const CAR_COLORS = ['#c0492f', '#2f6fb0', '#1f7a5a', '#d7a13a', '#cfd6dd', '#7a8694', '#b23b3b', '#3a4654'];
const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 33 + c.charCodeAt(0)) >>> 0; return h; };
const dark = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(((n >> 16) & 255) * f) | 0},${(((n >> 8) & 255) * f) | 0},${((n & 255) * f) | 0})`;
};

function factorGrid(cap: number): [number, number] {
  cap = Math.max(4, Math.min(60, Math.round(cap)));
  let best: [number, number] = [cap, 1], bestScore = 1e9;
  for (let r = 2; r <= 7; r++) {
    const c = Math.round(cap / r);
    if (c < 2) continue;
    const score = Math.abs(c * r - cap) * 2 + Math.abs(c / r - 2.0);
    if (score < bestScore) { bestScore = score; best = [c, r]; }
  }
  return best;
}

const SW = 2.0, SD = 4.2, AISLE = 3.2;   // fallback-grid stall width, depth, drive aisle (world units)

function CarMesh({ color }: { color: string }) {
  const body = dark(color, 0.92), cab = dark(color, 0.62);
  return (
    <group position={[0, 0, 0]}>
      <mesh castShadow position={[0, 0.42, 0]}><boxGeometry args={[1.5, 0.62, 3.2]} /><meshStandardMaterial color={body} metalness={0.3} roughness={0.45} /></mesh>
      <mesh castShadow position={[0, 0.92, -0.12]}><boxGeometry args={[1.32, 0.56, 1.5]} /><meshStandardMaterial color={cab} metalness={0.2} roughness={0.3} /></mesh>
      <mesh position={[0, 0.95, -0.12]}><boxGeometry args={[1.34, 0.4, 1.2]} /><meshStandardMaterial color="#bcd2e0" metalness={0.1} roughness={0.1} opacity={0.85} transparent /></mesh>
      {[[-0.72, 1.05], [0.72, 1.05], [-0.72, -1.05], [0.72, -1.05]].map(([wx, wz], i) => (
        <mesh key={i} position={[wx, 0.18, wz]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.26, 0.26, 0.18, 14]} /><meshStandardMaterial color="#15181c" roughness={0.7} /></mesh>
      ))}
    </group>
  );
}

function Tree({ x, z, s = 1 }: { x: number; z: number; s?: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh castShadow position={[0, 0.5, 0]}><cylinderGeometry args={[0.16, 0.22, 1, 7]} /><meshStandardMaterial color="#6b4f2a" roughness={0.9} /></mesh>
      <mesh castShadow position={[0, 1.6, 0]}><icosahedronGeometry args={[1.05, 0]} /><meshStandardMaterial color="#3f8f4f" roughness={0.85} flatShading /></mesh>
    </group>
  );
}

// landscaped island: a low planter mound (boulders/shrubs), optional shade tree
function IslandMesh({ x, z, rx, rz, tree }: Island) {
  return (
    <group position={[x, 0, z]}>
      <mesh receiveShadow castShadow position={[0, 0.1, 0]} scale={[rx, 1, rz]}>
        <cylinderGeometry args={[1, 1.1, 0.2, 18]} /><meshStandardMaterial color="#8a7a5c" roughness={1} />
      </mesh>
      <mesh position={[0, 0.26, 0]} scale={[rx * 0.8, 1, rz * 0.8]}>
        <sphereGeometry args={[0.7, 12, 8]} /><meshStandardMaterial color="#4f8f57" roughness={0.9} flatShading />
      </mesh>
      {tree && <Tree x={0} z={0} s={0.9} />}
    </group>
  );
}

function Scene({ map, cars, surface, capacity, stalls, layout }: Props) {
  const built = useMemo(() => {
    let mw = map?.[0] ?? 0, mh = map?.[1] ?? 0;
    const spots: Spot[] = [];
    const islands: Island[] = [];
    const geom = !stalls?.length ? synthLayout(layout) : null;

    if (stalls?.length) {
      // PAVED: real marked stalls projected to top-down (scripts/spatial.py)
      mw = mw || Math.max(...stalls.flatMap((s) => s.poly.map((p) => p[0])));
      mh = mh || Math.max(...stalls.flatMap((s) => s.poly.map((p) => p[1])));
      const sc = 24 / Math.max(mw, mh);
      stalls.forEach((s, i) => {
        const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
        const cx = ((Math.min(...xs) + Math.max(...xs)) / 2 - mw / 2) * sc;
        const cz = ((Math.min(...ys) + Math.max(...ys)) / 2 - mh / 2) * sc;
        spots.push({ x: cx, z: cz, w: SW, d: SD, rot: 0, occ: s.taken, color: CAR_COLORS[hash('s' + i) % CAR_COLORS.length] });
      });
    } else if (geom) {
      // LEARNED LAYOUT: the lot's real rows/angles/islands, 1:1
      const occ = snapCars(geom.stalls, cars, mw, mh);
      geom.stalls.forEach((s, i) => {
        spots.push({ x: s.x, z: s.z, w: s.w, d: s.d, rot: (s.rotDeg * Math.PI) / 180, occ: occ[i], color: CAR_COLORS[hash(s.key) % CAR_COLORS.length] });
      });
      geom.islands.forEach((is, i) => islands.push({ ...is, tree: i === 0 }));
    } else {
      // GRAVEL fallback: generic capacity grid + nearest-stall snap
      const [C, R] = factorGrid(capacity || Math.max(8, (cars?.length ?? 0) + 4));
      const occ = new Array(C * R).fill(false);
      const rowPitch = SD + AISLE;
      const W = C * SW, D = R * rowPitch;
      const pos = (c: number, r: number) => ({ x: (c + 0.5) * SW - W / 2, z: (r + 0.5) * rowPitch - D / 2 });
      for (const car of (cars ?? [])) {
        const cx = mw ? car.x / mw : 0.5, cy = mh ? car.y / mh : 0.5;
        let bi = -1, bd = 1e9;
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
          const i = r * C + c; if (occ[i]) continue;
          const dd = (cx - (c + 0.5) / C) ** 2 + (cy - (r + 0.5) / R) ** 2;
          if (dd < bd) { bd = dd; bi = i; }
        }
        if (bi >= 0) occ[bi] = true;
      }
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const i = r * C + c, p = pos(c, r);
        spots.push({ x: p.x, z: p.z, w: SW, d: SD, rot: 0, occ: occ[i], color: CAR_COLORS[hash(c + '-' + r) % CAR_COLORS.length] });
      }
    }
    const xs = spots.map((s) => s.x), zs = spots.map((s) => s.z);
    const halfW = (Math.max(...xs) - Math.min(...xs)) / 2 + SW, halfD = (Math.max(...zs) - Math.min(...zs)) / 2 + SD;
    return { spots, islands, halfW: Math.max(halfW, 4), halfD: Math.max(halfD, 4) };
  }, [map, cars, surface, capacity, stalls, layout]);

  if (!built.spots.length) return null;
  const { spots, islands, halfW, halfD } = built;
  const W = halfW * 2 + 2, D = halfD * 2 + 2;

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[halfW, 18, -halfD]} intensity={1.2} castShadow
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-left={-W} shadow-camera-right={W} shadow-camera-top={D} shadow-camera-bottom={-D} />
      <hemisphereLight args={['#cfe8ff', '#6b6256', 0.4]} />

      {/* ground slab: asphalt for paved, gravel-tan otherwise */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow position={[0, 0, 0]}>
        <planeGeometry args={[W, D]} /><meshStandardMaterial color={surface === 'gravel' ? '#b3a888' : '#3c424b'} roughness={surface === 'gravel' ? 1 : 0.95} />
      </mesh>
      {/* curb border */}
      {[[0, D / 2], [0, -D / 2]].map(([x, z], i) => (
        <mesh key={'cz' + i} position={[x, 0.12, z]}><boxGeometry args={[W, 0.24, 0.3]} /><meshStandardMaterial color="#c8ccd2" roughness={0.8} /></mesh>
      ))}
      {[[W / 2, 0], [-W / 2, 0]].map(([x, z], i) => (
        <mesh key={'cx' + i} position={[x, 0.12, z]}><boxGeometry args={[0.3, 0.24, D]} /><meshStandardMaterial color="#c8ccd2" roughness={0.8} /></mesh>
      ))}
      {/* grass apron */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[W + 8, D + 8]} /><meshStandardMaterial color="#5f9352" roughness={1} />
      </mesh>

      {spots.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]} rotation-y={s.rot}>
          {/* painted stall lines: two sides */}
          <mesh rotation-x={-Math.PI / 2} position={[-s.w / 2 + 0.05, 0.02, 0]}><planeGeometry args={[0.1, s.d]} /><meshStandardMaterial color="#eef2f5" /></mesh>
          <mesh rotation-x={-Math.PI / 2} position={[s.w / 2 - 0.05, 0.02, 0]}><planeGeometry args={[0.1, s.d]} /><meshStandardMaterial color="#eef2f5" /></mesh>
          {/* vacant glow / wheel stop */}
          {s.occ
            ? <mesh position={[0, 0.08, s.d / 2 - 0.4]}><boxGeometry args={[s.w * 0.7, 0.16, 0.18]} /><meshStandardMaterial color="#20242b" roughness={0.8} /></mesh>
            : <mesh rotation-x={-Math.PI / 2} position={[0, 0.025, 0]}><planeGeometry args={[s.w - 0.3, s.d - 0.4]} /><meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.4} transparent opacity={0.6} /></mesh>}
          {s.occ && <CarMesh color={s.color} />}
        </group>
      ))}

      {islands.map((is, i) => <IslandMesh key={'is' + i} {...is} />)}
      {!islands.length && <>
        <Tree x={-halfW - 2.5} z={-halfD - 1} s={1.2} />
        <Tree x={halfW + 2.5} z={halfD + 1} s={1} />
        <Tree x={halfW + 2} z={-halfD - 2} s={0.85} />
      </>}

      <OrbitControls makeDefault enablePan enableZoom target={[0, 0, 0]}
        maxPolarAngle={1.45} minDistance={Math.max(W, D) * 0.32} maxDistance={Math.max(W, D) * 1.8} />
    </>
  );
}

export default function Lot3D(props: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa6b2', fontSize: 13 }}>loading 3D…</div>;
  }
  // graceful fallback: never white-screen the page if a device/browser can't do WebGL
  let webgl = false;
  try { const c = document.createElement('canvas'); webgl = !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch { webgl = false; }
  if (!webgl) {
    return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa6b2', fontSize: 13 }}>3D needs WebGL — use the 2D view.</div>;
  }
  const span = 26;
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, span * 0.95, span * 0.85], fov: 40 }} style={{ width: '100%', height: '100%', display: 'block' }}>
      <color attach="background" args={['#eaf2ee']} />
      <fog attach="fog" args={['#eaf2ee', span * 1.4, span * 3]} />
      <Scene {...props} />
    </Canvas>
  );
}
