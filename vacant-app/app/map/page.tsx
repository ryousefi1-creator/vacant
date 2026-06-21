'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// Leaflet is browser-only — must be loaded dynamically with no SSR
const ParkingMap = dynamic(() => import('./ParkingMap'), { ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#e8eeec', color: '#6b7a8d', fontSize: 14 }}>
      Loading map…
    </div>
  )
});

type Occ = {
  ts: number; id: string; name: string; inside: number | null;
  capacity: number | null; stalls: unknown[] | null; image: string | null;
};

const FONT = 'var(--font-geist-sans), system-ui, sans-serif';
const GREEN = '#10b981'; const DARK = '#0d1b2a';

export default function MapPage() {
  // Live occupancy is the only source the map needs (served from memory/Redis, works on
  // Vercel). Real lot coordinates live in ParkingMap's LOT_COORDS table, not the filesystem.
  const [occ, setOcc] = useState<Record<string, Occ>>({});

  useEffect(() => {
    async function load() {
      const o = await fetch('/api/occupancy').then(r => r.json()).catch(() => ({}));
      setOcc(o || {});
    }
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: FONT, color: DARK,
      background: '#eef3f1' }}>

      {/* header */}
      <header style={{ padding: '14px 24px', background: '#fff', borderBottom: '1px solid #e7ecf0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ textDecoration: 'none', fontWeight: 800, fontSize: 20, color: DARK, letterSpacing: '-.3px' }}>
            Vac<span style={{ color: GREEN }}>ant</span>
          </Link>
          <span style={{ color: '#c5cfd8' }}>›</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#4a5568' }}>Parking Map</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginRight: 8, fontSize: 12.5, color: '#6b7a8d' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: GREEN, display: 'inline-block' }} /> Our live lots
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#3b82f6', display: 'inline-block' }} /> Nearby parking
            </span>
          </div>
          <Link href="/live" style={{ padding: '6px 14px', borderRadius: 9, background: '#f0f4f6',
            color: DARK, fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}>Dashboard</Link>
        </div>
      </header>

      {/* map fills the rest */}
      <ParkingMap occ={occ} />
    </div>
  );
}
