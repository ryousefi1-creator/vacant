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

const EMPTY_FORM = { name: '', url: '', capacity: '' };

export default function Home() {
  const [data, setData] = useState<Record<string, Occ>>({});
  const [active, setActive] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [view3d, setView3d] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

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

  async function handleAddLot(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true); setAddErr(null);
    try {
      const r = await fetch('/api/lots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, url: form.url, capacity: Number(form.capacity) || 0 }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || 'failed');
      setShowAdd(false); setForm(EMPTY_FORM);
    } catch (err) {
      setAddErr(String(err));
    } finally {
      setAdding(false);
    }
  }

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
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '14px 0 12px', scrollbarWidth: 'thin', alignItems: 'center' }}>
          {locs.length === 0 && <span style={{ color: '#8a97a6', fontSize: 13, padding: '8px 0' }}>waiting for the camera worker… (run scripts/push.py)</span>}
          <button onClick={() => { setShowAdd(true); setAddErr(null); }} style={{
            flexShrink: 0, cursor: 'pointer', border: '1.5px dashed #c5cfd8',
            background: 'transparent', color: '#6b7a8d', borderRadius: 11, padding: '7px 13px',
            fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add Lot
          </button>
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
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 400px', overflow: 'hidden' }}>
        {/* main — 2D/3D map */}
        <section style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
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

        {/* sidebar — camera feed on top, stats below */}
        <aside style={{ background: '#fff', borderLeft: '1px solid #e7ecf0', boxShadow: '-18px 0 40px rgba(13,27,42,.06)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* camera feed — prominent at top */}
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #f0f4f7' }}>
            <div style={{ color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '1.4px', fontSize: 11, fontWeight: 600, marginBottom: 10 }}>
              Camera · live detection
            </div>
            <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e7ecf0', background: '#0d1b2a', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {cur?.image
                ? <img src={cur.image} alt="live" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ color: '#6b7a8d', fontSize: 12 }}>waiting for frame…</span>}
            </div>
          </div>

          {/* stats below camera */}
          <div style={{ padding: '20px 24px', flex: 1 }}>
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
          </div>
        </aside>
      </div>
      {/* Add Lot modal */}
      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(13,27,42,.45)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={handleAddLot} style={{
            background: '#fff', borderRadius: 18, padding: '32px 28px', width: 420, maxWidth: '92vw',
            boxShadow: '0 24px 64px rgba(13,27,42,.22)', display: 'flex', flexDirection: 'column', gap: 18,
          }}>
            <div style={{ fontWeight: 800, fontSize: 18, color: '#0d1b2a', letterSpacing: '-.3px' }}>Add Parking Lot</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '1px' }}>Lot Name</label>
              <input
                required autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. HWPARKING2" style={{
                  border: '1.5px solid #e1e7ec', borderRadius: 10, padding: '10px 13px',
                  fontSize: 14, fontWeight: 500, outline: 'none', color: '#0d1b2a',
                  transition: 'border-color .15s',
                }}
                onFocus={e => e.target.style.borderColor = '#10b981'}
                onBlur={e => e.target.style.borderColor = '#e1e7ec'}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '1px' }}>Stream URL</label>
              <input
                required value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                placeholder="rtmp://… or rtsp://…" style={{
                  border: '1.5px solid #e1e7ec', borderRadius: 10, padding: '10px 13px',
                  fontSize: 13, fontWeight: 500, outline: 'none', color: '#0d1b2a', fontFamily: 'monospace',
                }}
                onFocus={e => e.target.style.borderColor = '#10b981'}
                onBlur={e => e.target.style.borderColor = '#e1e7ec'}
              />
              <span style={{ fontSize: 11, color: '#a3adb8' }}>Larix / IP camera RTMP or RTSP address</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Stall Count <span style={{ color: '#c5cfd8', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <input
                type="number" min="0" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
                placeholder="0 = auto-detect" style={{
                  border: '1.5px solid #e1e7ec', borderRadius: 10, padding: '10px 13px',
                  fontSize: 14, fontWeight: 500, outline: 'none', color: '#0d1b2a', width: 140,
                }}
                onFocus={e => e.target.style.borderColor = '#10b981'}
                onBlur={e => e.target.style.borderColor = '#e1e7ec'}
              />
            </div>

            {addErr && <div style={{ color: '#ef4444', fontSize: 12.5, fontWeight: 600 }}>{addErr}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" onClick={() => setShowAdd(false)} style={{
                border: '1.5px solid #e1e7ec', background: 'transparent', color: '#6b7a8d',
                borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Cancel</button>
              <button type="submit" disabled={adding} style={{
                border: 'none', cursor: adding ? 'not-allowed' : 'pointer',
                background: adding ? '#a7f3d0' : 'linear-gradient(160deg,#10b981,#059669)',
                color: '#fff', borderRadius: 10, padding: '9px 22px', fontSize: 13, fontWeight: 700,
                boxShadow: adding ? 'none' : '0 4px 12px rgba(16,185,129,.3)',
              }}>
                {adding ? 'Creating…' : 'Create Lot'}
              </button>
            </div>

            <div style={{ borderTop: '1px solid #f0f4f7', paddingTop: 14, fontSize: 11.5, color: '#a3adb8', lineHeight: 1.6 }}>
              The lot will appear in the worker immediately. Stall layout is auto-detected from the stream
              — or run <code style={{ background: '#f0f4f7', padding: '1px 5px', borderRadius: 4 }}>scripts/stall_vision.py --id &lt;id&gt;</code> for visual line detection.
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
