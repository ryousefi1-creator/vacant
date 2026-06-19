'use client';
// Navigable 3D digital-twin of a lot. Orbit / pan / zoom with the mouse (OrbitControls).
// GRAVEL: a car box at each detected car's TRUE position (homography-projected x,y).
// PAVED:  each marked stall as a pad (emerald = open, dark = taken) + a car on taken ones.
// Three.js is fine here because this is the HOSTED Next app, not a file:// page. The
// <Canvas> is gated behind a mount flag so it never renders during SSR (no window/WebGL).
import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

type Car = { x: number; y: number };
type Stall = { poly: [number, number][]; taken: boolean };

const CAR_COLORS = ['#3a4654', '#c0492f', '#2f6fb0', '#1f7a5a', '#d7a13a', '#cfd6dd', '#7a8694', '#b23b3b'];
const SPAN = 14;            // world size of the lot's long axis
const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 33 + c.charCodeAt(0)) >>> 0; return h; };
function darker(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(((n >> 16) & 255) * f) | 0},${(((n >> 8) & 255) * f) | 0},${((n & 255) * f) | 0})`;
}

function Car3D({ x, z, len, color, rot }: { x: number; z: number; len: number; color: string; rot: number }) {
  const w = len * 0.46, h = len * 0.3;
  return (
    <group position={[x, 0, z]} rotation-y={rot}>
      <mesh castShadow position={[0, h * 0.55, 0]}>
        <boxGeometry args={[w, h, len]} />
        <meshStandardMaterial color={color} metalness={0.25} roughness={0.5} />
      </mesh>
      <mesh castShadow position={[0, h * 1.08, -len * 0.04]}>
        <boxGeometry args={[w * 0.86, h * 0.62, len * 0.5]} />
        <meshStandardMaterial color={darker(color, 0.5)} metalness={0.1} roughness={0.35} />
      </mesh>
    </group>
  );
}

function Scene({ map, cars, surface, capacity, stalls }: Props) {
  const built = useMemo(() => {
    // derive the lot extent (map size, or the stalls' bounding box) -> world scale
    let mw = map?.[0] ?? 0, mh = map?.[1] ?? 0;
    if ((!mw || !mh) && stalls?.length) {
      const xs = stalls.flatMap((s) => s.poly.map((p) => p[0])), ys = stalls.flatMap((s) => s.poly.map((p) => p[1]));
      mw = Math.max(...xs); mh = Math.max(...ys);
    }
    if (!mw || !mh) return null;
    const sc = SPAN / Math.max(mw, mh);
    const gw = mw * sc, gd = mh * sc;
    const wx = (x: number) => (x - mw / 2) * sc, wz = (y: number) => (y - mh / 2) * sc;

    const carItems: { x: number; z: number; len: number; color: string; rot: number; key: string }[] = [];
    const padItems: { x: number; z: number; w: number; d: number; key: string }[] = [];

    if (stalls?.length) {
      const sizes = stalls.map((s) => {
        const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
        return Math.max(...xs) - Math.min(...xs);
      }).sort((a, b) => a - b);
      const len = (sizes[Math.floor(sizes.length / 2)] || mw / 12) * sc * 0.82;
      stalls.forEach((s, i) => {
        const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        if (s.taken) carItems.push({ x: wx(cx), z: wz(cy), len, color: CAR_COLORS[hash('s' + i) % CAR_COLORS.length], rot: 0, key: 's' + i });
        else padItems.push({ x: wx(cx), z: wz(cy), w: len * 0.9, d: len * 1.7, key: 'p' + i });
      });
    } else if (cars?.length) {
      const len = SPAN * 0.05;
      cars.forEach((c, i) => carItems.push({
        x: wx(c.x), z: wz(c.y), len, color: CAR_COLORS[hash(`${c.x.toFixed(1)}-${c.y.toFixed(1)}`) % CAR_COLORS.length],
        rot: ((hash(`${i}-${c.x}`) % 7) - 3) * 0.04, key: 'c' + i,
      }));
    }
    return { gw, gd, carItems, padItems };
  }, [map, cars, surface, capacity, stalls]);

  if (!built) return null;
  const ground = surface === 'paved' ? '#3a4150' : '#9a8567';
  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[SPAN * 0.5, SPAN, SPAN * 0.4]} intensity={1.15} castShadow
        shadow-mapSize-width={1024} shadow-mapSize-height={1024}
        shadow-camera-left={-SPAN} shadow-camera-right={SPAN} shadow-camera-top={SPAN} shadow-camera-bottom={-SPAN} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[built.gw + 2, built.gd + 2]} />
        <meshStandardMaterial color={ground} roughness={0.95} />
      </mesh>
      <gridHelper args={[Math.max(built.gw, built.gd) + 2, 16, '#ffffff', '#ffffff']} position={[0, 0.01, 0]}>
        <lineBasicMaterial transparent opacity={0.07} />
      </gridHelper>
      {built.padItems.map((p) => (
        <mesh key={p.key} rotation-x={-Math.PI / 2} position={[p.x, 0.02, p.z]} receiveShadow>
          <planeGeometry args={[p.w, p.d]} />
          <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={0.35} transparent opacity={0.78} />
        </mesh>
      ))}
      {built.carItems.map(({ key, ...c }) => <Car3D key={key} {...c} />)}
      <OrbitControls makeDefault enablePan enableZoom target={[0, 0, 0]}
        maxPolarAngle={1.45} minDistance={SPAN * 0.35} maxDistance={SPAN * 2.6} />
    </>
  );
}

type Props = {
  map: [number, number] | null;
  cars: Car[] | null;
  surface: string | null;
  capacity: number | null;
  stalls: Stall[] | null;
};

export default function Lot3D(props: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9aa6b2', fontSize: 13 }}>loading 3D…</div>;
  }
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, SPAN * 0.85, SPAN], fov: 42 }} style={{ width: '100%', height: '100%', display: 'block' }}>
      <color attach="background" args={['#eef3f1']} />
      <Scene {...props} />
    </Canvas>
  );
}
