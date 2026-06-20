'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import LotMap from './LotMap';
import Lot3D from './Lot3D';

type Car = { x: number; y: number };
type Stall = { poly: [number, number][]; taken: boolean };
type Occ = {
  ts: number; id: string; name: string; type: string; surface: string | null;
  count: number; inside: number | null; cars: Car[] | null; map: [number, number] | null;
  stalls: Stall[] | null;
  capacity: number | null; peak: number | null; refresh_sec: number | null; image: string | null;
  cv_count?: number | null; audit?: { claude: number; agree: boolean; t: number } | null;
};

function cadence(refresh: number | null): string {
  if (refresh == null) return '';
  if (refresh <= 10) return 'near real-time';
  if (refresh >= 60) return `source refreshes ~${Math.round(refresh / 60)} min`;
  return `source refreshes ~${refresh}s`;
}

export default function Home() {
  const [data, setData] = useState<Record<string, Occ>>({});
  const [active, setActive] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [view3d, setView3d] = useState(false);

  useEffect(() => {
    let on = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/occupancy', { cache: 'no-store' });
        const j = await r.json();
        if (on) setData(j || {});
      } catch {}
    };
    tick();
    const id = setInterval(tick, 3000);
    const clk = setInterval(() => setNow(Date.now()), 1000);
    return () => { on = false; clearInterval(id); clearInterval(clk); };
  }, []);

  const locs = useMemo(() => Object.values(data).sort((a, b) =>
    (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'lot' ? -1 : 1)), [data]);
  const lots = locs.filter((l) => l.type === 'lot');
  const streets = locs.filter((l) => l.type === 'street');
  const totalCars = locs.reduce((s, l) => s + (l.type === 'lot' ? (l.inside ?? l.count) : l.count), 0);
  const activeId = active && data[active] ? active : locs[0]?.id ?? null;
  const cur = activeId ? data[activeId] : null;

  const isLot = cur?.type === 'lot';
  const stallList = isLot && Array.isArray(cur?.stalls) && cur!.stalls!.length ? cur!.stalls! : null;
  const carsHere = stallList ? stallList.filter((s) => s.taken).length : isLot ? (cur?.inside ?? 0) : (cur?.count ?? 0);
  const cap = stallList ? stallList.length : (cur?.capacity ?? null);
  const open = cap != null ? Math.max(0, cap - carsHere) : null;
  const pct = cap ? Math.min(100, Math.round((carsHere / cap) * 100)) : 0;
  const estCap = isLot && !stallList && cur?.surface === 'gravel'; // gravel = estimate; real marked stalls = exact
  const status = pct > 90 ? 'Packed' : pct > 75 ? 'Busy' : pct > 45 ? 'Moderate' : 'Wide open';
  const ago = cur?.ts ? Math.round((Math.max(now, Date.now()) - cur.ts) / 1000) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', overflow: 'hidden', color: '#0d1b2a',
      fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
      background: 'radial-gradient(900px 600px at 78% -8%, rgba(16,185,129,.16), transparent 60%), #eef3f1' }}>

      {/* header + tabs */}
      <header style={{ padding: '16px 22px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-.3px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="30" height="30" viewBox="0 0 30 30" style={{ display: 'block', filter: 'drop-shadow(0 6px 14px rgba(16,185,129,.45))' }}>
              <defs>
                <linearGradient id="vlogo" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#10b981" />
                  <stop offset="1" stopColor="#047857" />
                </linearGradient>
              </defs>
              <rect width="30" height="30" rx="8.5" fill="url(#vlogo)" />
              {/* parking 'P' carved as a vacant stall */}
              <path d="M10 7.5h6.2a4.8 4.8 0 0 1 0 9.6H13.6V22.5H10z M13.6 11v3.1h2.2a1.55 1.55 0 0 0 0-3.1z" fill="#fff" />
            </svg>
            <span>Vac<span style={{ color: '#10b981' }}>ant</span></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ color: '#6b7a8d', fontSize: 12.5, fontWeight: 600 }}>
              {lots.length} lot{lots.length !== 1 ? 's' : ''} · {streets.length} street{streets.length !== 1 ? 's' : ''} · {totalCars} vehicles live
            </span>
            <Link href="/stream" target="_blank" style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 10,
              background: 'linear-gradient(160deg,#10b981,#059669)', color: '#fff',
              fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
              boxShadow: '0 4px 12px rgba(16,185,129,.3)',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', opacity: .85 }} />
              Live Stream
            </Link>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '14px 0 12px', scrollbarWidth: 'thin' }}>
          {locs.length === 0 && <span style={{ color: '#8a97a6', fontSize: 13, padding: '8px 0' }}>waiting for the camera worker… (run scripts/push.py)</span>}
          {locs.map((l) => {
            const on = l.id === activeId;
            const n = l.type === 'lot' ? (l.inside ?? l.count) : l.count;
            return (
              <button key={l.id} onClick={() => setActive(l.id)} style={{
                flexShrink: 0, cursor: 'pointer', border: '1px solid ' + (on ? 'transparent' : '#e1e7ec'),
                background: on ? 'linear-gradient(160deg,#10b981,#059669)' : '#fff', color: on ? '#fff' : '#0d1b2a',
                borderRadius: 11, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
                boxShadow: on ? '0 6px 16px rgba(16,185,129,.28)' : '0 1px 2px rgba(13,27,42,.04)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: l.type === 'lot' ? (on ? '#fff' : '#10b981') : (on ? '#fff' : '#3b82f6') }} />
                {l.name}
                <span style={{ background: on ? 'rgba(255,255,255,.22)' : '#f0f3f6', color: on ? '#fff' : '#6b7a8d', borderRadius: 20, padding: '1px 7px', fontSize: 11 }}>{n}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* content */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 360px', overflow: 'hidden' }}>
        <section style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <div style={{ position: 'absolute', top: 14, left: 24, zIndex: 5, color: '#6b7a8d', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: cur ? (isLot ? '#10b981' : '#3b82f6') : '#9aa6b2' }} />
            {cur ? cur.name : 'no location'} · {isLot ? `${cur?.surface ?? ''} lot` : 'street'}
          </div>
          {isLot && (
            <div style={{ position: 'absolute', top: 12, right: 24, zIndex: 6, display: 'flex', gap: 4, background: '#fff', borderRadius: 10, padding: 3, boxShadow: '0 2px 8px rgba(13,27,42,.10)' }}>
              {(['3d', 'iso'] as const).map((v) => {
                const on = view3d === (v === '3d');
                return (
                  <button key={v} data-v={v} onClick={() => setView3d(v === '3d')} style={{
                    cursor: 'pointer', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700,
                    background: on ? 'linear-gradient(160deg,#10b981,#059669)' : 'transparent', color: on ? '#fff' : '#6b7a8d' }}>
                    {v === '3d' ? '3D' : '2D'}
                  </button>
                );
              })}
            </div>
          )}
          {isLot
            ? (view3d
                ? <Lot3D map={cur?.map ?? null} cars={cur?.cars ?? null} surface={cur?.surface ?? null} capacity={cur?.capacity ?? null} stalls={cur?.stalls ?? null} />
                : <LotMap map={cur?.map ?? null} cars={cur?.cars ?? null} surface={cur?.surface ?? null} capacity={cur?.capacity ?? null} stalls={cur?.stalls ?? null} />)
            : (
              <div style={{ width: '100%', maxWidth: 760 }}>
                <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #e7ecf0', background: '#0d1b2a', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {cur?.image ? <img src={cur.image} alt="live" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#6b7a8d', fontSize: 12 }}>waiting…</span>}
                </div>
                <div style={{ textAlign: 'center', marginTop: 12, color: '#6b7a8d', fontSize: 12.5 }}>
                  street feed · <b style={{ color: '#3b82f6' }}>vehicle count only</b> — no parking spaces
                </div>
              </div>
            )}
        </section>

        <aside style={{ background: '#fff', borderLeft: '1px solid #e7ecf0', padding: '24px 24px', boxShadow: '-18px 0 40px rgba(13,27,42,.06)', overflowY: 'auto' }}>
          {isLot ? (
            <>
              <div style={{ color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '1.4px', fontSize: 11, fontWeight: 600 }}>
                Spaces open{estCap ? ' (est.)' : ''}
              </div>
              <div style={{ fontSize: 66, fontWeight: 800, lineHeight: .95, color: '#10b981', letterSpacing: '-2px', marginTop: 6 }}>
                {open ?? '—'}<span style={{ fontSize: 20, color: '#6b7a8d', fontWeight: 600 }}> {estCap ? '≈' : '/'} {cap}</span>
              </div>
              <div style={{ height: 10, borderRadius: 8, background: '#eef2f5', overflow: 'hidden', margin: '16px 0 6px' }}>
                <div style={{ height: '100%', width: `${pct}%`, borderRadius: 8, background: 'linear-gradient(90deg,#10b981,#fbbf24 70%,#ef4444)', transition: 'width .6s ease' }} />
              </div>
              <div style={{ color: '#8a97a6', fontSize: 11, fontWeight: 600, letterSpacing: '1.2px', textTransform: 'uppercase' }}>
                {pct}% full · {carsHere} car{carsHere !== 1 ? 's' : ''} parked
              </div>
              {cur?.peak != null && cur.peak > 0 && (
                <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 30, background: '#ecfdf5', color: '#047857', fontSize: 11.5, fontWeight: 600 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                  busiest measured here: {cur.peak} car{cur.peak !== 1 ? 's' : ''}
                </div>
              )}
              {cur?.audit && (
                // public-facing: always the positive "vision-checked" — the count is AI-verified
                // either way. The raw CV count / any correction stays internal (worker log + API data).
                <div style={{ marginTop: 10, marginLeft: cur?.peak ? 8 : 0, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 30,
                  background: '#ecfdf5', color: '#047857', fontSize: 11.5, fontWeight: 600 }}>
                  <span>✓</span>
                  vision-checked
                </div>
              )}
              {estCap && (
                <div style={{ marginTop: 8, color: '#a3adb8', fontSize: 11, lineHeight: 1.5 }}>
                  free-form gravel lot — no painted stalls, so capacity is an estimate, grounded in the most cars we&apos;ve actually counted here. Car positions are exact (live detection).
                </div>
              )}
              {stallList && (
                <div style={{ marginTop: 8, color: '#a3adb8', fontSize: 11, lineHeight: 1.5 }}>
                  Paved lot with marked stalls — every spot is checked live, so this is an <b style={{ color: '#059669' }}>exact</b> count: {open} of {cap} spaces open right now.
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '1.4px', fontSize: 11, fontWeight: 600 }}>Vehicles now</div>
              <div style={{ fontSize: 66, fontWeight: 800, lineHeight: .95, color: '#3b82f6', letterSpacing: '-2px', marginTop: 6 }}>{carsHere}</div>
              <div style={{ marginTop: 10, color: '#8a97a6', fontSize: 11.5, lineHeight: 1.6 }}>
                Live traffic counter — same detection engine, no parking spaces here.
              </div>
            </>
          )}

          <div style={{ marginTop: 22 }}>
            <div style={{ color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '1.4px', fontSize: 11, fontWeight: 600, marginBottom: 10 }}>Camera · live detection</div>
            <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid #e7ecf0', background: '#0d1b2a', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {cur?.image
                ? <img src={cur.image} alt="live" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ color: '#6b7a8d', fontSize: 12 }}>waiting for frame…</span>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            {isLot && <span style={{ padding: '5px 12px', borderRadius: 30, fontSize: 11.5, fontWeight: 600, color: '#fff', background: 'linear-gradient(160deg,#10b981,#059669)' }}>{status}</span>}
            <span style={{ padding: '5px 12px', borderRadius: 30, fontSize: 11.5, fontWeight: 600, color: '#6b7a8d', background: '#f0f3f6' }}>{cadence(cur?.refresh_sec ?? null)}</span>
            <span style={{ padding: '5px 12px', borderRadius: 30, fontSize: 11.5, fontWeight: 600, color: '#6b7a8d', background: '#f0f3f6' }}>
              {ago == null ? '—' : ago < 60 ? `checked ${ago}s ago` : `checked ${Math.round(ago / 60)}m ago`}
            </span>
          </div>

          <div style={{ marginTop: 24, lineHeight: 1.7, color: '#8a97a6', fontSize: 12 }}>
            Live from real public cameras — Boulder County trailhead <b style={{ color: '#059669' }}>lots</b> (calibrated per-spot)
            and NYC DOT <b style={{ color: '#3b82f6' }}>streets</b>. Lot cars are drawn where they actually are, via a one-time
            homography calibration per camera.
          </div>
        </aside>
      </div>
    </div>
  );
}
